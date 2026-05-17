# Standalone Compose Migration Design

**Date:** 2026-05-17  
**Status:** Draft  
**Scope:** Migrate all 8 legacy Hermes agents from shared docker-compose files to standalone per-agent compose files managed by Swarm Map.

---

## Summary

Move all agents currently defined in `hermes-swarm/docker-compose.yml` (5 agents + litellm) and `hermes-swarm/docker-compose.seraphim.yml` (3 seraphs + vertex-proxy) to standalone compose files at `~/.hermes-swarm-map/compose/{name}/docker-compose.yml`. Infrastructure services (litellm, vertex-proxy) become standalone host-bound services. Each agent gets network isolation, independent lifecycle, and full Swarm Map management.

---

## Agents to Migrate

| Agent | Current Port | Data Dir | Notes |
|-------|-------------|----------|-------|
| hermes-personal | 8642 | ~/.hermes | Primary agent, gateway |
| hermes-osint | 8652 | ~/.hermes-osint | |
| hermes-cyborg | 8662 | ~/.hermes-cyborg | Uses Signal API |
| hermes-cryptids | 8672 | ~/.hermes-cryptids | |
| hermes-egregore | 8682 | ~/.hermes-egregore | |
| seraph-thinker | 8692 | ~/.hermes-seraph-thinker | Shared athanor mount |
| seraph-doer | 8702 | ~/.hermes-seraph-doer | Shared athanor mount |
| seraph-generalist | 8712 | ~/.hermes-seraph-generalist | Shared athanor mount |

---

## Architecture

### Infrastructure Layer (host-bound, always-on)

```
~/.hermes-swarm-map/infra/
├── litellm/
│   ├── docker-compose.yml
│   └── litellm-config.yaml
└���─ vertex-proxy/
    ├── docker-compose.yml
    └── server.py (copied from hermes-swarm/vertex-proxy/)
```

- **litellm**: port 4100:4000, stateless LLM proxy (Bedrock + Vertex)
- **vertex-proxy**: port 4200:4200, OpenAI-compatible Vertex AI proxy

Both run on host-bound ports with no shared Docker network. Agents reach them via `host.docker.internal:{port}`.

### Agent Layer (standalone, isolated)

Each agent at `~/.hermes-swarm-map/compose/{name}/docker-compose.yml`:

```yaml
services:
  hermes-{name}:
    image: ghcr.io/nousresearch/hermes-agent:latest
    container_name: hermes-{name}
    restart: unless-stopped
    env_file:
      - {agentDataDir}/.env
    ports:
      - published: {port}
        target: 8642
    volumes:
      - {agentDataDir}:/root/.hermes

networks:
  default:
    name: hermes-{name}
```

### Seraph Additions

Seraphs get two extra volume mounts:

```yaml
    volumes:
      - {agentDataDir}:/root/.hermes
      - ~/Documents/GitHub/athanor:/opt/athanor
      - ~/.hermes-seraph-shared-skills:/root/.hermes/skills/shared
```

The shared skills directory (`~/.hermes-seraph-shared-skills/`) is mounted into all three seraphs, giving them concurrent access to coordination skills (seraphim-loop, athanor-pipeline-maintenance, etc.) while preserving individual skills in their own data dirs.

---

## Mount Point Change

| | Legacy | Standalone |
|---|---|---|
| Host path | `~/.hermes-{name}` | `~/.hermes-{name}` (unchanged) |
| Container mount | `/opt/data` | `/root/.hermes` |
| Image | Built from repo | `ghcr.io/nousresearch/hermes-agent:latest` |

The published image expects data at `/root/.hermes`. The host-side data directory is unchanged. No files are moved or modified.

---

## Migration Strategy: Option A (Lift and Shift)

One agent at a time, sequential, with rollback at every step.

### Pre-Migration (once)

1. **Full backup:**
   ```bash
   tar czf ~/hermes-backup-$(date +%Y%m%d).tar.gz \
     ~/.hermes ~/.hermes-osint ~/.hermes-cyborg \
     ~/.hermes-cryptids ~/.hermes-egregore \
     ~/.hermes-seraph-thinker ~/.hermes-seraph-doer \
     ~/.hermes-seraph-generalist
   ```

2. **Back up compose files:**
   ```bash
   cp hermes-swarm/docker-compose.yml hermes-swarm/docker-compose.yml.bak
   cp hermes-swarm/docker-compose.seraphim.yml hermes-swarm/docker-compose.seraphim.yml.bak
   ```

3. **Deploy infrastructure services:**
   - Generate litellm standalone compose
   - Generate vertex-proxy standalone compose
   - Start both, verify they respond on ports 4100/4200
   - Update agent .env files: `LLM_API_BASE=http://host.docker.internal:4100/v1`
     (only if they currently reference `litellm-proxy:4000` via Docker DNS — check first)

### Per-Agent Migration (repeat for each)

For agent `{name}` on port `{port}`:

1. **Generate standalone compose:**
   ```bash
   # Via Swarm Map API or manual generation
   mkdir -p ~/.hermes-swarm-map/compose/{name}
   # Write docker-compose.yml (template above)
   ```

2. **Dry-run verification:**
   ```bash
   docker compose -f ~/.hermes-swarm-map/compose/{name}/docker-compose.yml \
     config --quiet
   ```
   Validates the compose file parses correctly.

3. **Stop agent in legacy compose:**
   ```bash
   docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml \
     stop hermes-{name}
   ```

4. **Start standalone agent:**
   ```bash
   docker compose -f ~/.hermes-swarm-map/compose/{name}/docker-compose.yml \
     up -d
   ```

5. **Verify:**
   - Container is running: `docker ps | grep hermes-{name}`
   - Agent gateway responds: `curl -s http://localhost:{port}/health`
   - Logs look clean: `docker logs hermes-{name} --tail 20`
   - Agent visible in Swarm Map UI

6. **Rollback (if needed):**
   ```bash
   docker compose -f ~/.hermes-swarm-map/compose/{name}/docker-compose.yml down
   docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml \
     start hermes-{name}
   ```

### Migration Order

Start with lowest-risk, validate pattern, then proceed:

1. **hermes-egregore** — least active, good canary
2. **hermes-osint** — independent
3. **hermes-cyborg** — has Signal dependency (verify signal reachability)
4. **hermes-cryptids** — Telegram-facing
5. **hermes-personal** — primary agent, most important (migrate last of main group)
6. **seraph-thinker** — first seraph (validate shared skills mount)
7. **seraph-doer** — second seraph
8. **seraph-generalist** — last seraph

### Post-Migration

1. **Remove agents from legacy compose** (don't delete file — keep as reference):
   ```bash
   # Comment out migrated services, leave file intact
   ```

2. **Update Swarm Map settings** to stop scanning legacy compose files:
   - Remove hermes-swarm compose paths from `settings.json` `composeFiles[]`
   - Swarm Map now only discovers standalone agents

3. **Verify Swarm Map discovers all 8 agents** in its UI

4. **Delete backup tar** after 1 week of stable operation

---

## Seraph Shared Skills Design

### Problem

The three seraphs need coordinated skills (propose-improvement, seraphim-loop, athanor-pipeline-maintenance) that evolve together, plus individual skills for their specialization.

### Solution

```
~/.hermes-seraph-shared-skills/
├── seraphim-loop/
├── athanor-pipeline-maintenance/
├── athanor-create-and-review/
└── ... (coordination skills)
```

Each seraph's compose mounts this as a subdirectory of their skills path. The Hermes agent loads skills from all subdirectories of its skills folder, so shared skills appear alongside individual ones.

**Populating shared skills:** Before migration, extract the common skills from any one seraph's directory:
```bash
mkdir -p ~/.hermes-seraph-shared-skills
cp -r ~/.hermes-seraph-thinker/skills/seraphim-loop ~/.hermes-seraph-shared-skills/
cp -r ~/.hermes-seraph-thinker/skills/athanor-pipeline-maintenance ~/.hermes-seraph-shared-skills/
# ... other shared skills
```

Then remove duplicates from individual seraph skill dirs post-migration (once verified working).

### Skills that remain individual

| Seraph | Individual skills |
|--------|------------------|
| thinker | autonomous, research-heavy skills |
| doer | execution, deployment skills |
| generalist | browser-form-automation, seraphim-report, two-tier-content-approval |

---

## Env File Handling

**CRITICAL: No .env files are modified during migration** unless an agent currently references `litellm-proxy:4000` via Docker DNS (which would break without the shared network).

Verified: only `~/.hermes-egregore/.env` references `litellm-proxy` and it's already commented out. **No .env changes required for any agent.**

---

## Swarm Map Code Changes

The Swarm Map's `generateStandaloneCompose()` function already produces the correct template. Changes needed:

1. **Import existing agents:** Add a migration script or API endpoint that:
   - Reads a legacy compose file
   - Extracts service definitions
   - Generates standalone compose files preserving port assignments
   - Creates overlay entries in `harnesses.json`

2. **Seraph template variant:** The compose generator needs an option for extra volumes (athanor mount, shared skills mount).

3. **Infrastructure management:** Optionally teach Swarm Map about the infra services (litellm, vertex-proxy) as a new service type — not harnesses, but dependencies it can health-check.

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Data loss during migration | Full tar backup before starting. Host dirs never modified. |
| Wrong mount point breaks agent | Verify first canary agent (egregore) boots and loads SOUL.md |
| Published image missing `gateway` command | Test: `docker run --rm ghcr.io/nousresearch/hermes-agent:latest gateway --help` |
| Port conflicts from stale containers | `docker compose down` old before `up` new. Verify with `docker ps`. |
| Signal API unreachable post-migration | Already uses `host.docker.internal:8080` — no change needed |
| Shared skills mount conflicts | Mount as subdirectory, not root — can't clobber individual skills |
| Swarm Map can't discover migrated agents | Standalone compose lives in its expected path — discovery should work automatically |

---

## Validation Checklist (per agent)

- [ ] Container starts without errors
- [ ] `curl localhost:{port}/health` returns 200
- [ ] Agent loads correct SOUL.md (check persona in Swarm Map)
- [ ] Agent connects to its surface (Telegram/Mattermost/etc.)
- [ ] LLM calls work (agent can respond to a message)
- [ ] Swarm Map shows agent as "running" with correct stats
- [ ] Memories and sessions accessible (check logs for load errors)

---

## Out of Scope

- Modifying agent configs, personas, or skills (beyond shared skills extraction)
- Changing port assignments
- Upgrading Hermes agent version
- Modifying Swarm Map UI
- Signal API containerization changes
