# Standalone Compose Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 8 Hermes agents from shared docker-compose files to standalone per-agent compose files managed by Swarm Map, with infrastructure services (litellm, vertex-proxy) as independent host-bound services.

**Architecture:** Each agent gets its own `docker-compose.yml` at `~/.hermes-swarm-map/compose/{name}/`. Infrastructure proxies live at `~/.hermes-swarm-map/infra/{service}/`. Agents are isolated on individual Docker networks. All external services reached via `host.docker.internal`.

**Tech Stack:** Docker Compose, bash scripting, YAML generation. No application code changes.

**Spec:** `docs/superpowers/specs/2026-05-17-standalone-compose-migration-design.md`

---

## Context for the Implementer

**What you're doing:** Moving 8 Hermes AI agents from two shared docker-compose files to individual standalone compose files. This is an infrastructure migration — no application code changes.

**Where things live:**
- Legacy compose files: `~/Documents/GitHub/hermes-swarm/docker-compose.yml` and `docker-compose.seraphim.yml`
- Agent data directories: `~/.hermes/` (personal) and `~/.hermes-{name}/` (others)
- Swarm Map compose dir: `~/.hermes-swarm-map/compose/{name}/docker-compose.yml`
- Swarm Map infra dir (new): `~/.hermes-swarm-map/infra/{service}/docker-compose.yml`

**Key constraint:** Agent data directories (`~/.hermes-{name}/`) must NEVER be modified, deleted, or moved. They contain irreplaceable configs, memories, and credentials. The migration only changes how Docker mounts them.

**Mount point change:** Legacy mounts at `/opt/data` inside the container. The published image (`nousresearch/hermes-agent:latest`) expects `/root/.hermes`. Same host dir, different container path.

**IMPORTANT:** Run all commands on the Mac Mini (`junis-mac-mini.local`) where Docker and the agents actually run. If running remotely via SSH, prefix Docker commands accordingly.

---

## Task 1: Full Backup

**Files:**
- Create: `~/hermes-backup-20260517.tar.gz`
- Create: `~/hermes-compose-backup/docker-compose.yml`
- Create: `~/hermes-compose-backup/docker-compose.seraphim.yml`

- [ ] **Step 1: Back up all agent data directories**

```bash
tar czf ~/hermes-backup-20260517.tar.gz \
  ~/.hermes \
  ~/.hermes-osint \
  ~/.hermes-cyborg \
  ~/.hermes-cryptids \
  ~/.hermes-egregore \
  ~/.hermes-seraph-thinker \
  ~/.hermes-seraph-doer \
  ~/.hermes-seraph-generalist
```

Expected: tar file created (~50-200MB depending on session history). Verify:
```bash
ls -lh ~/hermes-backup-20260517.tar.gz
tar tzf ~/hermes-backup-20260517.tar.gz | head -20
```

- [ ] **Step 2: Back up legacy compose files**

```bash
mkdir -p ~/hermes-compose-backup
cp ~/Documents/GitHub/hermes-swarm/docker-compose.yml ~/hermes-compose-backup/
cp ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml ~/hermes-compose-backup/
cp ~/Documents/GitHub/hermes-swarm/litellm-config.yaml ~/hermes-compose-backup/
cp -r ~/Documents/GitHub/hermes-swarm/vertex-proxy ~/hermes-compose-backup/
```

- [ ] **Step 3: Verify backups**

```bash
diff ~/Documents/GitHub/hermes-swarm/docker-compose.yml ~/hermes-compose-backup/docker-compose.yml
diff ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml ~/hermes-compose-backup/docker-compose.seraphim.yml
echo "Backup size: $(du -sh ~/hermes-backup-20260517.tar.gz | cut -f1)"
echo "Compose backup: $(ls ~/hermes-compose-backup/ | wc -l) files"
```

Expected: diffs show no differences, backup exists with reasonable size.

- [ ] **Step 4: Commit checkpoint**

```bash
cd ~/Documents/GitHub/hermes-swarm-map
git add docs/superpowers/specs/2026-05-17-standalone-compose-migration-design.md
git add docs/superpowers/plans/2026-05-17-standalone-compose-migration.md
git commit -m "docs: migration spec and plan for standalone compose"
```

---

## Task 2: Deploy Infrastructure — LiteLLM

**Files:**
- Create: `~/.hermes-swarm-map/infra/litellm/docker-compose.yml`
- Create: `~/.hermes-swarm-map/infra/litellm/litellm-config.yaml`

- [ ] **Step 1: Create infra directory structure**

```bash
mkdir -p ~/.hermes-swarm-map/infra/litellm
mkdir -p ~/.hermes-swarm-map/infra/vertex-proxy
```

- [ ] **Step 2: Copy litellm config**

```bash
cp ~/Documents/GitHub/hermes-swarm/litellm-config.yaml ~/.hermes-swarm-map/infra/litellm/litellm-config.yaml
```

- [ ] **Step 3: Write litellm standalone compose**

Create `~/.hermes-swarm-map/infra/litellm/docker-compose.yml`:

```yaml
# LiteLLM proxy — standalone infrastructure service
# Translates OpenAI-compatible calls to Bedrock + Vertex AI
# Managed by hermes-swarm-map infra layer
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    container_name: litellm-proxy
    volumes:
      - ./litellm-config.yaml:/app/config.yaml:ro
    env_file:
      - ~/.hermes/.env
    command: ["--config", "/app/config.yaml", "--port", "4000"]
    ports:
      - "4100:4000"
    restart: unless-stopped
```

- [ ] **Step 4: Stop litellm in legacy compose**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml stop litellm
```

- [ ] **Step 5: Start standalone litellm**

```bash
docker compose -f ~/.hermes-swarm-map/infra/litellm/docker-compose.yml up -d
```

- [ ] **Step 6: Verify litellm is running**

```bash
docker ps | grep litellm-proxy
curl -s http://localhost:4100/health | head -5
```

Expected: container running, health endpoint responds.

- [ ] **Step 7: Rollback if broken**

If litellm doesn't start:
```bash
docker compose -f ~/.hermes-swarm-map/infra/litellm/docker-compose.yml down
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml start litellm
```

---

## Task 3: Deploy Infrastructure — Vertex Proxy

**Files:**
- Create: `~/.hermes-swarm-map/infra/vertex-proxy/docker-compose.yml`
- Create: `~/.hermes-swarm-map/infra/vertex-proxy/server.py`
- Create: `~/.hermes-swarm-map/infra/vertex-proxy/Dockerfile`

- [ ] **Step 1: Copy vertex-proxy source**

```bash
cp ~/Documents/GitHub/hermes-swarm/vertex-proxy/server.py ~/.hermes-swarm-map/infra/vertex-proxy/
cp ~/Documents/GitHub/hermes-swarm/vertex-proxy/Dockerfile ~/.hermes-swarm-map/infra/vertex-proxy/
```

- [ ] **Step 2: Write vertex-proxy standalone compose**

Create `~/.hermes-swarm-map/infra/vertex-proxy/docker-compose.yml`:

```yaml
# Vertex AI proxy ��� standalone infrastructure service
# OpenAI-compatible proxy for Google Vertex AI (Gemini)
# Managed by hermes-swarm-map infra layer
services:
  vertex-proxy:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: vertex-proxy
    env_file:
      - ~/.hermes/.env
    ports:
      - "4200:4200"
    restart: unless-stopped
```

- [ ] **Step 3: Stop vertex-proxy in legacy compose**

```bash
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml stop vertex-proxy
```

- [ ] **Step 4: Start standalone vertex-proxy**

```bash
docker compose -f ~/.hermes-swarm-map/infra/vertex-proxy/docker-compose.yml up -d --build
```

- [ ] **Step 5: Verify vertex-proxy is running**

```bash
docker ps | grep vertex-proxy
curl -s http://localhost:4200/v1/models 2>&1 | head -5
```

Expected: container running, responds on port 4200.

- [ ] **Step 6: Rollback if broken**

If vertex-proxy doesn't start:
```bash
docker compose -f ~/.hermes-swarm-map/infra/vertex-proxy/docker-compose.yml down
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml start vertex-proxy
```

---

## Task 4: Migrate Canary — hermes-egregore

**Files:**
- Create: `~/.hermes-swarm-map/compose/egregore/docker-compose.yml`

This is the first agent migration. Go slow, verify everything. The pattern established here repeats for all other agents.

- [ ] **Step 1: Create compose directory**

```bash
mkdir -p ~/.hermes-swarm-map/compose/egregore
```

- [ ] **Step 2: Write standalone compose file**

Create `~/.hermes-swarm-map/compose/egregore/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: egregore
services:
  hermes-egregore:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-egregore
    restart: unless-stopped
    env_file:
      - /root/.hermes-egregore/.env
    ports:
      - published: 8682
        target: 8642
    volumes:
      - /root/.hermes-egregore:/root/.hermes

networks:
  default:
    name: hermes-egregore
```

**NOTE:** Replace `/root/.hermes-egregore` with the actual absolute path on the target machine. On the Mac Mini this is likely `/Users/juniperbevensee/.hermes-egregore`. On Linux it would be `/root/.hermes-egregore` or `/home/{user}/.hermes-egregore`. Use the expanded `~` path:

```yaml
# Generated by hermes-swarm-map — agent: egregore
services:
  hermes-egregore:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-egregore
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes-egregore/.env
    ports:
      - published: 8682
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes-egregore:/root/.hermes

networks:
  default:
    name: hermes-egregore
```

- [ ] **Step 3: Validate compose file syntax**

```bash
docker compose -f ~/.hermes-swarm-map/compose/egregore/docker-compose.yml config --quiet
```

Expected: no output (silent success).

- [ ] **Step 4: Pull the published image**

```bash
docker pull nousresearch/hermes-agent:latest
```

Expected: image pulled successfully.

- [ ] **Step 5: Stop egregore in legacy compose**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml stop hermes-egregore
```

Expected: `Container hermes-egregore  Stopped`

- [ ] **Step 6: Remove old container (free the name)**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml rm -f hermes-egregore
```

Expected: container removed. The name `hermes-egregore` is now free.

- [ ] **Step 7: Start standalone egregore**

```bash
docker compose -f ~/.hermes-swarm-map/compose/egregore/docker-compose.yml up -d
```

Expected: container starts.

- [ ] **Step 8: Verify container is running**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep egregore
```

Expected: `hermes-egregore   Up X seconds   0.0.0.0:8682->8642/tcp`

- [ ] **Step 9: Check logs for startup errors**

```bash
docker logs hermes-egregore --tail 30
```

Expected: agent boots, loads SOUL.md, connects to gateway. Look for:
- "Loading persona from SOUL.md" or similar
- No "file not found" or "permission denied" errors
- Gateway listening message

- [ ] **Step 10: Verify agent responds**

```bash
curl -s http://localhost:8682/health 2>&1 || echo "No health endpoint — check logs instead"
```

If no health endpoint, the boot logs from Step 9 are the verification.

- [ ] **Step 11: Verify in Swarm Map UI**

Open Swarm Map (http://localhost:3000 or wherever it runs). Check that hermes-egregore appears as "running" with correct CPU/memory stats.

- [ ] **Step 12: Rollback if anything is wrong**

If the agent doesn't work:
```bash
# Stop standalone
docker compose -f ~/.hermes-swarm-map/compose/egregore/docker-compose.yml down

# Restart in legacy compose
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml up -d hermes-egregore
```

Investigate the issue before retrying.

---

## Task 5: Migrate hermes-osint

**Files:**
- Create: `~/.hermes-swarm-map/compose/osint/docker-compose.yml`

- [ ] **Step 1: Create compose directory and file**

```bash
mkdir -p ~/.hermes-swarm-map/compose/osint
```

Create `~/.hermes-swarm-map/compose/osint/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: osint
services:
  hermes-osint:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-osint
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes-osint/.env
    ports:
      - published: 8652
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes-osint:/root/.hermes

networks:
  default:
    name: hermes-osint
```

- [ ] **Step 2: Validate**

```bash
docker compose -f ~/.hermes-swarm-map/compose/osint/docker-compose.yml config --quiet
```

- [ ] **Step 3: Stop and remove old container**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml stop hermes-osint
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml rm -f hermes-osint
```

- [ ] **Step 4: Start standalone**

```bash
docker compose -f ~/.hermes-swarm-map/compose/osint/docker-compose.yml up -d
```

- [ ] **Step 5: Verify**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep osint
docker logs hermes-osint --tail 20
```

Expected: running on port 8652, clean boot logs.

- [ ] **Step 6: Rollback if needed**

```bash
docker compose -f ~/.hermes-swarm-map/compose/osint/docker-compose.yml down
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml up -d hermes-osint
```

---

## Task 6: Migrate hermes-cyborg

**Files:**
- Create: `~/.hermes-swarm-map/compose/cyborg/docker-compose.yml`

- [ ] **Step 1: Create compose directory and file**

```bash
mkdir -p ~/.hermes-swarm-map/compose/cyborg
```

Create `~/.hermes-swarm-map/compose/cyborg/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: cyborg
services:
  hermes-cyborg:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-cyborg
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes-cyborg/.env
    ports:
      - published: 8662
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes-cyborg:/root/.hermes

networks:
  default:
    name: hermes-cyborg
```

- [ ] **Step 2: Validate**

```bash
docker compose -f ~/.hermes-swarm-map/compose/cyborg/docker-compose.yml config --quiet
```

- [ ] **Step 3: Stop and remove old container**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml stop hermes-cyborg
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml rm -f hermes-cyborg
```

- [ ] **Step 4: Start standalone**

```bash
docker compose -f ~/.hermes-swarm-map/compose/cyborg/docker-compose.yml up -d
```

- [ ] **Step 5: Verify (including Signal reachability)**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep cyborg
docker logs hermes-cyborg --tail 20
# Verify Signal API is reachable from inside the container:
docker exec hermes-cyborg curl -s http://host.docker.internal:8080/v1/about 2>&1 | head -5
```

Expected: running on port 8662, Signal API reachable via host.docker.internal.

- [ ] **Step 6: Rollback if needed**

```bash
docker compose -f ~/.hermes-swarm-map/compose/cyborg/docker-compose.yml down
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml up -d hermes-cyborg
```

---

## Task 7: Migrate hermes-cryptids

**Files:**
- Create: `~/.hermes-swarm-map/compose/cryptids/docker-compose.yml`

- [ ] **Step 1: Create compose directory and file**

```bash
mkdir -p ~/.hermes-swarm-map/compose/cryptids
```

Create `~/.hermes-swarm-map/compose/cryptids/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: cryptids
services:
  hermes-cryptids:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-cryptids
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes-cryptids/.env
    ports:
      - published: 8672
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes-cryptids:/root/.hermes

networks:
  default:
    name: hermes-cryptids
```

- [ ] **Step 2: Validate**

```bash
docker compose -f ~/.hermes-swarm-map/compose/cryptids/docker-compose.yml config --quiet
```

- [ ] **Step 3: Stop and remove old container**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml stop hermes-cryptids
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml rm -f hermes-cryptids
```

- [ ] **Step 4: Start standalone**

```bash
docker compose -f ~/.hermes-swarm-map/compose/cryptids/docker-compose.yml up -d
```

- [ ] **Step 5: Verify**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep cryptids
docker logs hermes-cryptids --tail 20
```

Expected: running on port 8672, clean boot.

- [ ] **Step 6: Rollback if needed**

```bash
docker compose -f ~/.hermes-swarm-map/compose/cryptids/docker-compose.yml down
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml up -d hermes-cryptids
```

---

## Task 8: Migrate hermes-personal

**Files:**
- Create: `~/.hermes-swarm-map/compose/personal/docker-compose.yml`

This is the primary agent — most important, migrate last of the main group.

- [ ] **Step 1: Create compose directory and file**

```bash
mkdir -p ~/.hermes-swarm-map/compose/personal
```

Create `~/.hermes-swarm-map/compose/personal/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: personal
services:
  hermes-personal:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-personal
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes/.env
    ports:
      - published: 8642
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes:/root/.hermes

networks:
  default:
    name: hermes-personal
```

Note: personal agent uses `~/.hermes` (no suffix).

- [ ] **Step 2: Validate**

```bash
docker compose -f ~/.hermes-swarm-map/compose/personal/docker-compose.yml config --quiet
```

- [ ] **Step 3: Stop and remove old container**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml stop hermes-personal
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml rm -f hermes-personal
```

- [ ] **Step 4: Start standalone**

```bash
docker compose -f ~/.hermes-swarm-map/compose/personal/docker-compose.yml up -d
```

- [ ] **Step 5: Verify**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep personal
docker logs hermes-personal --tail 20
```

Expected: running on port 8642, clean boot, gateway active.

- [ ] **Step 6: Rollback if needed**

```bash
docker compose -f ~/.hermes-swarm-map/compose/personal/docker-compose.yml down
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml up -d hermes-personal
```

---

## Task 9: Set Up Seraph Shared Skills

**Files:**
- Create: `~/.hermes-seraph-shared-skills/` (directory with shared skill folders)

- [ ] **Step 1: Identify shared skills**

Compare skill directories across all three seraphs to find the common ones:

```bash
comm -12 \
  <(ls ~/.hermes-seraph-thinker/skills/ | sort) \
  <(ls ~/.hermes-seraph-doer/skills/ | sort) | \
  comm -12 - \
  <(ls ~/.hermes-seraph-generalist/skills/ | sort)
```

Expected: list of skills present in all three seraphs (these are candidates for sharing).

- [ ] **Step 2: Create shared skills directory**

```bash
mkdir -p ~/.hermes-seraph-shared-skills
```

- [ ] **Step 3: Copy shared skills from generalist (most complete)**

Copy the skills identified in Step 1. Based on current state, the coordination-specific ones are:

```bash
cp -r ~/.hermes-seraph-generalist/skills/seraphim-loop ~/.hermes-seraph-shared-skills/
cp -r ~/.hermes-seraph-generalist/skills/athanor-pipeline-maintenance ~/.hermes-seraph-shared-skills/
cp -r ~/.hermes-seraph-generalist/skills/athanor-create-and-review ~/.hermes-seraph-shared-skills/
```

**IMPORTANT:** Only copy skills that are genuinely shared coordination skills. Skills like `apple`, `gaming`, `leisure` are general-purpose and should stay individual (even if duplicated). The shared mount is for skills that MUST stay in sync across seraphs.

- [ ] **Step 4: Verify shared skills copied correctly**

```bash
ls ~/.hermes-seraph-shared-skills/
diff -r ~/.hermes-seraph-generalist/skills/seraphim-loop ~/.hermes-seraph-shared-skills/seraphim-loop
```

Expected: skills present, content matches source.

---

## Task 10: Migrate seraph-thinker

**Files:**
- Create: `~/.hermes-swarm-map/compose/seraph-thinker/docker-compose.yml`

- [ ] **Step 1: Create compose directory and file**

```bash
mkdir -p ~/.hermes-swarm-map/compose/seraph-thinker
```

Create `~/.hermes-swarm-map/compose/seraph-thinker/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: seraph-thinker
services:
  hermes-seraph-thinker:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-seraph-thinker
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes-seraph-thinker/.env
    ports:
      - published: 8692
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes-seraph-thinker:/root/.hermes
      - /Users/juniperbevensee/Documents/GitHub/athanor:/opt/athanor
      - /Users/juniperbevensee/.hermes-seraph-shared-skills:/root/.hermes/skills/shared

networks:
  default:
    name: hermes-seraph-thinker
```

- [ ] **Step 2: Validate**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-thinker/docker-compose.yml config --quiet
```

- [ ] **Step 3: Stop and remove old container**

```bash
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml stop seraph-thinker
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml rm -f seraph-thinker
```

- [ ] **Step 4: Start standalone**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-thinker/docker-compose.yml up -d
```

- [ ] **Step 5: Verify**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep seraph-thinker
docker logs hermes-seraph-thinker --tail 20
# Verify athanor mount is accessible:
docker exec hermes-seraph-thinker ls /opt/athanor 2>&1 | head -5
# Verify shared skills mount:
docker exec hermes-seraph-thinker ls /root/.hermes/skills/shared 2>&1 | head -5
```

Expected: running on port 8692, athanor visible, shared skills visible.

- [ ] **Step 6: Rollback if needed**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-thinker/docker-compose.yml down
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml up -d seraph-thinker
```

---

## Task 11: Migrate seraph-doer

**Files:**
- Create: `~/.hermes-swarm-map/compose/seraph-doer/docker-compose.yml`

- [ ] **Step 1: Create compose directory and file**

```bash
mkdir -p ~/.hermes-swarm-map/compose/seraph-doer
```

Create `~/.hermes-swarm-map/compose/seraph-doer/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: seraph-doer
services:
  hermes-seraph-doer:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-seraph-doer
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes-seraph-doer/.env
    ports:
      - published: 8702
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes-seraph-doer:/root/.hermes
      - /Users/juniperbevensee/Documents/GitHub/athanor:/opt/athanor
      - /Users/juniperbevensee/.hermes-seraph-shared-skills:/root/.hermes/skills/shared

networks:
  default:
    name: hermes-seraph-doer
```

- [ ] **Step 2: Validate**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-doer/docker-compose.yml config --quiet
```

- [ ] **Step 3: Stop and remove old container**

```bash
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml stop seraph-doer
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml rm -f seraph-doer
```

- [ ] **Step 4: Start standalone**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-doer/docker-compose.yml up -d
```

- [ ] **Step 5: Verify**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep seraph-doer
docker logs hermes-seraph-doer --tail 20
docker exec hermes-seraph-doer ls /opt/athanor 2>&1 | head -5
docker exec hermes-seraph-doer ls /root/.hermes/skills/shared 2>&1 | head -5
```

Expected: running on port 8702, both mounts accessible.

- [ ] **Step 6: Rollback if needed**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-doer/docker-compose.yml down
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml up -d seraph-doer
```

---

## Task 12: Migrate seraph-generalist

**Files:**
- Create: `~/.hermes-swarm-map/compose/seraph-generalist/docker-compose.yml`

- [ ] **Step 1: Create compose directory and file**

```bash
mkdir -p ~/.hermes-swarm-map/compose/seraph-generalist
```

Create `~/.hermes-swarm-map/compose/seraph-generalist/docker-compose.yml`:

```yaml
# Generated by hermes-swarm-map — agent: seraph-generalist
services:
  hermes-seraph-generalist:
    image: nousresearch/hermes-agent:latest
    container_name: hermes-seraph-generalist
    restart: unless-stopped
    env_file:
      - /Users/juniperbevensee/.hermes-seraph-generalist/.env
    ports:
      - published: 8712
        target: 8642
    volumes:
      - /Users/juniperbevensee/.hermes-seraph-generalist:/root/.hermes
      - /Users/juniperbevensee/Documents/GitHub/athanor:/opt/athanor
      - /Users/juniperbevensee/.hermes-seraph-shared-skills:/root/.hermes/skills/shared

networks:
  default:
    name: hermes-seraph-generalist
```

- [ ] **Step 2: Validate**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-generalist/docker-compose.yml config --quiet
```

- [ ] **Step 3: Stop and remove old container**

```bash
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml stop seraph-generalist
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml rm -f seraph-generalist
```

- [ ] **Step 4: Start standalone**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-generalist/docker-compose.yml up -d
```

- [ ] **Step 5: Verify**

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep seraph-generalist
docker logs hermes-seraph-generalist --tail 20
docker exec hermes-seraph-generalist ls /opt/athanor 2>&1 | head -5
docker exec hermes-seraph-generalist ls /root/.hermes/skills/shared 2>&1 | head -5
```

Expected: running on port 8712, both mounts accessible.

- [ ] **Step 6: Rollback if needed**

```bash
docker compose -f ~/.hermes-swarm-map/compose/seraph-generalist/docker-compose.yml down
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml up -d seraph-generalist
```

---

## Task 13: Post-Migration Verification

- [ ] **Step 1: Verify all 8 agents are running standalone**

```bash
echo "=== All Hermes containers ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep hermes

echo ""
echo "=== Infra containers ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep -E "litellm|vertex"
```

Expected output should show:
- hermes-personal (8642)
- hermes-osint (8652)
- hermes-cyborg (8662)
- hermes-cryptids (8672)
- hermes-egregore (8682)
- hermes-seraph-thinker (8692)
- hermes-seraph-doer (8702)
- hermes-seraph-generalist (8712)
- litellm-proxy (4100)
- vertex-proxy (4200)

- [ ] **Step 2: Verify no legacy containers remain**

```bash
docker compose -f ~/Documents/GitHub/hermes-swarm/docker-compose.yml ps
docker compose -p seraphim -f ~/Documents/GitHub/hermes-swarm/docker-compose.seraphim.yml ps
```

Expected: no running containers from either legacy compose.

- [ ] **Step 3: Verify Swarm Map discovers all agents**

Open Swarm Map UI. All 8 agents should appear with "running" status and live stats.

If any are missing, check that Swarm Map's settings scan `~/.hermes-swarm-map/compose/` correctly.

- [ ] **Step 4: Spot-check agent functionality**

Pick 2-3 agents and send them a test message via their surface (Telegram, Mattermost). Verify they respond.

- [ ] **Step 5: Verify Docker networks are isolated**

```bash
docker network ls | grep hermes
```

Expected: individual networks (`hermes-egregore`, `hermes-osint`, etc.) — NOT `hermes-swarm_hermes-net` (the old shared network).

---

## Task 14: Cleanup

- [ ] **Step 1: Remove old shared Docker network (if no containers use it)**

```bash
docker network rm hermes-swarm_hermes-net 2>/dev/null || echo "Network already removed or still in use"
```

- [ ] **Step 2: Comment out migrated services in legacy compose**

Edit `~/Documents/GitHub/hermes-swarm/docker-compose.yml` — add a comment at the top:

```yaml
# DEPRECATED: All agents migrated to standalone compose files 2026-05-17.
# Standalone compose lives at ~/.hermes-swarm-map/compose/{name}/
# Infra services at ~/.hermes-swarm-map/infra/{service}/
# This file kept as reference only.
```

Do the same for `docker-compose.seraphim.yml`.

- [ ] **Step 3: Update Swarm Map settings (if needed)**

If `~/.hermes-swarm-map/settings.json` has a `composeFiles` array pointing to the legacy files, remove those entries so Swarm Map stops scanning them:

```bash
cat ~/.hermes-swarm-map/settings.json
# Edit if needed to remove legacy compose file paths
```

- [ ] **Step 4: Remove duplicate shared skills from individual seraph dirs**

After confirming shared skills work via the mount, remove the duplicates from individual dirs:

```bash
# Only after verifying seraphs load shared skills correctly!
rm -rf ~/.hermes-seraph-thinker/skills/seraphim-loop
rm -rf ~/.hermes-seraph-thinker/skills/athanor-pipeline-maintenance
rm -rf ~/.hermes-seraph-doer/skills/seraphim-loop
rm -rf ~/.hermes-seraph-doer/skills/athanor-pipeline-maintenance
rm -rf ~/.hermes-seraph-doer/skills/athanor-create-and-review
# Keep individual-only skills untouched
```

- [ ] **Step 5: Final commit**

```bash
cd ~/Documents/GitHub/hermes-swarm-map
git add -A
git commit -m "feat: standalone compose migration complete — 8 agents + 2 infra services"
```

- [ ] **Step 6: Schedule backup deletion**

After 1 week of stable operation:
```bash
rm ~/hermes-backup-20260517.tar.gz
rm -rf ~/hermes-compose-backup/
```

Do NOT delete these until you're confident everything works.

---

## Rollback — Nuclear Option

If everything goes wrong and you need to restore the entire old system:

```bash
# Stop all standalone agents
for dir in ~/.hermes-swarm-map/compose/*/; do
  docker compose -f "$dir/docker-compose.yml" down 2>/dev/null
done
docker compose -f ~/.hermes-swarm-map/infra/litellm/docker-compose.yml down 2>/dev/null
docker compose -f ~/.hermes-swarm-map/infra/vertex-proxy/docker-compose.yml down 2>/dev/null

# Restore legacy compose files
cp ~/hermes-compose-backup/docker-compose.yml ~/Documents/GitHub/hermes-swarm/
cp ~/hermes-compose-backup/docker-compose.seraphim.yml ~/Documents/GitHub/hermes-swarm/

# Bring up legacy system
cd ~/Documents/GitHub/hermes-swarm
docker compose up -d
docker compose -p seraphim -f docker-compose.seraphim.yml up -d
```

Data directories were never modified, so no restore from tar needed unless something else went wrong.
