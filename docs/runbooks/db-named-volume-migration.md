# DB named-volume migration (#204 PR2)

Moves a harness's SQLite files (`state.db`, `response_store.db`, `kanban.db`, with
`-wal`/`-shm` siblings) off the VirtioFS bind mount — a proven torn-write corruption
vector — onto a named Docker volume (`hermes-state-<name>`, native ext4 inside the
VM), leaving symlinks at the old `/opt/data` paths so the agent needs no changes.

## Migrate one harness

```
POST /api/harnesses/<id>/migrate-db        # operator-authed; one at a time by design
```

The route: surgically transforms the existing compose (never regenerates — see
Guards), validates it with `docker compose config`, stops the agent, recreates —
compose runs the one-shot `state-init-<name>` service to completion **before** the
agent starts, so files move while no writer exists — then poll-verifies: init exit 0,
host `state.db` is now a symlink, agent running. The response lists every step.

**Canary discipline:** migrate one low-stakes harness, watch it for a few days (the
`/api/integrity` sweep + write-failure badge from #205 are the watchers), then roll
the next. There is deliberately no fleet-wide endpoint.

## What changes for host-side readers

The host path `~/.hermes-<name>/state.db` becomes a **dangling symlink** (its target
exists only in-container). Cost/usage/memory reads and the integrity sweep detect
this (`lstat`) and switch:

- **usage/cost/memory** read `state.db.snapshot` — exported every ~5 min
  (`DB_SNAPSHOT_INTERVAL_MS`) via `docker exec` + Python's `sqlite3` backup API,
  atomic tmp+rename. Until the first export lands, they report **unknown, not 0**.
  Numbers are up to one interval stale; do not treat them as live.
- **integrity checks** run `quick_check` via `docker exec python3` inside the
  container — where SQLite's locking actually holds — instead of the host path.
  (Side benefit: big-DB checks no longer block the dashboard's event loop.)
- **logs** stay on the bind mount; nothing about log reading changes.

## Guards you may hit

- **409 "cannot transform compose"** — the compose file's shape defeated the
  surgical transformer (hand-edited structure, missing anchors). By design it
  refuses rather than regenerating: regeneration from the standalone template
  silently strips deploy-born hardening (`read_only`, tmpfs, google-MCP), VPN
  sidecars, and hand edits. Fix the file by hand or migrate that harness manually.
- **409 on settings PUT (deploy-born)** — VPN/resource changes regenerate the
  compose from the standalone template, which would strip deploy-born extras; the
  settings route now refuses those on deploy-born composes before writing anything.

## `hermes import` un-migrates (self-healing)

An in-container `hermes import` restore replaces the symlink with a regular file —
the harness silently runs on the bind mount again until its next recreate. This is
survivable by design: the init service treats a **regular file as authoritative**
(it is the newer data) and re-migrates it to the volume on every recreate. If you
know an import happened, just recreate the container rather than waiting.

## Rollback (de-migrate one harness)

1. Stop the agent: `docker stop hermes-<name>`.
2. Copy files back from the volume to the bind mount, replacing the symlinks:
   ```
   docker run --rm -v hermes-state-<name>:/state -v ~/.hermes-<name>:/opt/data \
     <agent-image> sh -c 'for db in state.db response_store.db kanban.db; do
       [ -f /state/$db ] || continue
       for suf in "" -wal -shm; do rm -f /opt/data/$db$suf; done
       for suf in "" -wal -shm; do [ -f /state/$db$suf ] && cp -p /state/$db$suf /opt/data/$db$suf; done
     done'
   ```
3. Remove the migration wiring from the compose file (the `state-init-<name>`
   service, its `depends_on` entry, the `- hermes-state-<name>:/state` mount, and
   the top-level `volumes:` block).
4. `docker compose up -d --force-recreate`, then delete the volume once satisfied:
   `docker volume rm hermes-state-<name>`.

**Never `docker compose down -v`** on a migrated harness — it deletes the named
volume, i.e. the live databases.
