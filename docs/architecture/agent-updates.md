# Agent Updates

A deployed Hermes agent has **two independent update surfaces**. Knowing which
one a change lives in tells you how to ship it.

## 1. Runtime image (baked, immutable)

The Hermes runtime code at `/opt/hermes` is baked into the Docker image. It
changes only when the image is rebuilt.

- **What lives here:** core Hermes code, platform/gateway adapters, system
  tools, security fixes — anything in the `hermes-agent` image.
- **How it updates:** rebuild the image and recreate the container. There is no
  automatic pull — a running agent stays on its built image until you rebuild.
- **Scope:** the rebuild picks up whatever the image source (local build or
  pinned tag) is at that moment.

Restart modes (`POST /api/harnesses/:id/restart` with `{ mode }`):

| mode | what it does | use when |
|---|---|---|
| `quick` | `docker compose restart` — bounce the process | config/env reload, no image change |
| `recreate` | `up -d --force-recreate` — new container, **same image**, reloads env + hot-mounted `/opt/data` | picked up new artifacts/config without an image change |
| `rebuild` | `up -d --build --force-recreate` — rebuild image, then recreate | shipped new runtime code |
| `purge` | `build --no-cache` then recreate | a clean from-scratch image build |

> A `rebuild` updates **code**, not artifacts — it does **not** re-run artifact
> installation. New plugins/skills do not arrive via rebuild; use sync (below).

## 2. Artifacts (hot-mounted, mutable)

Plugins, skills, and hooks live in the agent's `/opt/data` dir, hot-mounted from
the host. They are installed at **create/duplicate** from the manifest
(`infra/artifacts.json`), and synced onto **existing** agents on demand.

- **What lives here:** plugins, skills, hooks, config overrides.
- **How it updates:** `POST /api/harnesses/:id/artifacts/sync`
  (`lib/services/artifacts-sync.ts`).
  - Installs artifacts that are **missing** (additive floor — never clobbers).
  - Updates an existing artifact **only if a content-hash lock
    (`.artifacts-lock.json`) proves it's unmodified** since install; a
    user-edited or untracked artifact is skipped. `force` overrides.
  - Enables newly-installed plugins in `config.yaml`, and recreates the
    container only if something changed. `dryRun` returns the plan with no writes.
- **Scope:** per-agent, immediate.

## Choosing

- New plugin/skill added to the manifest → **sync** the agents that should get it.
- Runtime code / security fix shipped → **rebuild** to pick up the new image.
- Corrupted agent → fix the data dir and `recreate`, or `purge` to reset.

## Known gap: no CD for the runtime image

Artifact rollout is a single API call per agent, but the **runtime-image** half
is still manual (build/pull + rebuild, no version pinning or staged rollout).
Closing that — pinned images + an approval-gated, canary-then-fleet rollout — is
tracked as future work.
