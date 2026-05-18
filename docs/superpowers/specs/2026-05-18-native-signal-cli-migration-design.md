# Native Signal-CLI Migration

**Date:** 2026-05-18
**Status:** Design approved
**Scope:** hermes-swarm (adapter), hermes-swarm-map (routes), signal-cli container (replacement), harness configs

## Problem

The hermes-swarm fork replaced the upstream Hermes signal adapter (SSE + JSON-RPC against native signal-cli daemon) with a polling REST adapter against bbernhard/signal-cli-rest-api. This caused:

1. Silent registration failures (CLI exits 0 on error, REST layer doesn't see CLI-registered accounts)
2. Loss of features: typing indicators, reactions, markdown formatting
3. Higher latency (polling every 3s vs real-time SSE)
4. Divergence from upstream Hermes community patterns

## Decision

Migrate back to native signal-cli daemon mode, aligned with upstream hermes-agent.

## Architecture

### Signal-CLI Container

Replace `bbernhard/signal-cli-rest-api` with a custom lightweight image.

**Image:** `signal-cli-native` (built locally)
**Base:** `eclipse-temurin:17-jre-alpine`
**Binary:** signal-cli 0.14.1 from GitHub releases
**Entrypoint:** `signal-cli --config /data daemon --http 0.0.0.0:8080`
**Volume:** `~/.hermes-swarm/signal-data:/data` (account persistence)
**Port:** 8080
**Container name:** `signal-cli-daemon` (unchanged)
**Health check:** `curl -sf http://localhost:8080/api/v1/check`

Standalone compose at `hermes-swarm-map/infra/signal-cli/docker-compose.yml`:

```yaml
services:
  signal-cli-daemon:
    build: .
    container_name: signal-cli-daemon
    restart: unless-stopped
    ports:
      - "8080:8080"
    volumes:
      - ~/.hermes-swarm/signal-data:/data
    networks:
      - hermes-net
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8080/api/v1/check"]
      interval: 30s
      timeout: 5s
      retries: 3

networks:
  hermes-net:
    external: true
```

### Hermes Adapter (hermes-swarm)

**Action:** Replace `gateway/platforms/signal.py` with upstream's version from `hermes-agent`.

**Upstream adapter provides:**
- SSE inbound: `GET /api/v1/events?account={phone}`
- JSON-RPC outbound: `POST /api/v1/rpc` (methods: send, sendTyping, sendReaction, getAttachment, listContacts)
- Health: `GET /api/v1/check`
- Markdown → Signal bodyRanges formatting
- Typing indicators with per-chat cooldown
- Emoji reactions
- Note-to-Self support
- Exponential backoff reconnection

**Additions to upstream code (merged from fork):**
- DM gate: check `SIGNAL_ALLOWED_USERS` / `SIGNAL_GROUP_ALLOWED_USERS` allowlists before processing messages
- Swarm-map policy check: optional `SWARM_MAP_POLICY_URL` env var for admin gate integration

**No env var changes for agents.** `SIGNAL_HTTP_URL` and `SIGNAL_ACCOUNT` semantics are identical.

### Swarm-Map Signal Routes

All routes talk to the same `signal-cli-daemon:8080` endpoint but use native protocols.

**Health** (`app/api/surfaces/signal/route.ts`):
- Health: `GET http://localhost:8080/api/v1/check`
- Account list: JSON-RPC `POST /api/v1/rpc` with `{"jsonrpc":"2.0","method":"listAccounts","id":"1"}`

**Register** (`app/api/surfaces/signal/register/route.ts`):
- `docker exec signal-cli-daemon signal-cli --config /data -a {phone} register [--captcha {token}]`
- Parse stdout/stderr for captcha/rate-limit/failure keywords even on exit code 0

**Verify** (`app/api/surfaces/signal/verify/route.ts`):
- `docker exec signal-cli-daemon signal-cli --config /data -a {phone} verify {code}`
- After verify: confirm via JSON-RPC `listAccounts` that the number appears with registered=true
- Profile name: `docker exec signal-cli-daemon signal-cli --config /data -a {phone} updateProfile --given-name {name}`

**Groups** (`app/api/surfaces/signal/groups/route.ts`):
- JSON-RPC `POST /api/v1/rpc` with `{"jsonrpc":"2.0","method":"listGroups","id":"1","params":{"account":"{phone}"}}`

### Harness .env Updates

Two harnesses need `SIGNAL_HTTP_URL` pointed to Docker DNS (they currently use `host.docker.internal`):

- `~/.hermes-cyborg/.env`: `SIGNAL_HTTP_URL=http://signal-cli-daemon:8080`
- `~/.hermes-seraph-generalist/.env`: `SIGNAL_HTTP_URL=http://signal-cli-daemon:8080`

### Deployment Sequence

1. Create `infra/signal-cli/` directory with Dockerfile + compose
2. Build image: `docker compose build`
3. Stop old bbernhard container: `docker stop signal-cli-daemon && docker rm signal-cli-daemon`
4. Start new native container: `docker compose up -d`
5. Verify health: `curl http://localhost:8080/api/v1/check`
6. Register number via swarm-map UI (captcha flow)
7. Update harness .env files (SIGNAL_HTTP_URL → docker DNS)
8. Rebuild hermes-swarm image (new adapter)
9. Restart affected harnesses (cyborg, seraph-generalist)
10. End-to-end test: send Signal message → get response

## Scope Boundaries

**In scope:**
- New signal-cli container image + compose
- Hermes adapter replacement (upstream port + DM gate merge)
- Swarm-map route rewrites (4 files)
- Harness .env fixups
- Fresh registration of +14474507704

**Out of scope:**
- Multi-account support (one daemon can serve multiple numbers — works already)
- Signal group auto-approve (P3 backlog item)
- Telegram/Mattermost changes (unrelated)

## Risks

- **signal-cli version compatibility:** Pin to 0.14.1 (matches what was in bbernhard). Upgrade path: change ARG in Dockerfile.
- **Upstream adapter drift:** If upstream changes signal.py significantly, we need to re-merge DM gate additions. Low risk — upstream is stable.
- **Registration rate limits:** If the number has been registered too many times recently, Signal may rate-limit. Wait 24h if needed.
