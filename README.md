# Hermes Swarm Map

Open-source admin GUI for orchestrating [Hermes](https://github.com/NousResearch/hermes-agent) agent harnesses. Discover, create, configure, start/stop/restart, and audit Hermes agents running in Docker — including API key management, tool registries, model fallback chains, and memory scopes across your fleet.

<!-- TODO: Add screenshots here -->

---

## Quick Start

```bash
pnpm install
pnpm seed        # first run: writes settings + tier config
pnpm dev         # http://localhost:3000
```

On first launch, the setup wizard detects your Hermes compose directories automatically. Point it at your `hermes-swarm/` directory and go.

---

## Running on a Mac Mini / Remote Server

Build once, run in production mode:

```bash
pnpm build
npx next start --port 3002 --hostname 0.0.0.0
```

Access from any machine on the network at `http://<hostname>:3002`. Run behind nginx or Tailscale for HTTPS or external access.

The smart dev script (`bin/dev.sh`) handles port conflicts automatically — finds a free port, kills zombie Swarm Map processes, skips ports used by other services.

---

## Creating a New Agent

**Via the GUI:** Navigate to `/setup/wizard` or click "Create New" on the harnesses page. The 5-step wizard walks through:

1. **Name & Identity** — agent name, persona (SOUL.md), habitat tier
2. **Model Configuration** — provider + ordered fallback cascade
3. **Surfaces & Integrations** — Mattermost, Telegram, Signal connections
4. **API Keys** — LLM provider key + optional integrations (GitHub, Brave)
5. **Deploy** — pulls image, scaffolds config, starts container

Each agent gets a standalone compose file at `~/.hermes-swarm-map/compose/{name}/docker-compose.yml` and a data directory at `~/.hermes-{name}/`.

**Via the API:** You can also drive agent management programmatically:

```bash
# List all harnesses
curl http://localhost:3002/api/harnesses

# Restart a harness
curl -X POST http://localhost:3002/api/harnesses/h_personal/restart \
  -H "Content-Type: application/json" \
  -d '{"mode":"quick"}'

# Deploy a new agent
curl -X POST http://localhost:3002/api/setup/deploy \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent","provider":"anthropic","primaryModel":"claude-sonnet-4-6"}'

# Get logs
curl http://localhost:3002/api/harnesses/h_personal/logs?lines=50
```

This means **any AI agent (Claude Code, Hermes, etc.) can orchestrate your fleet via the REST API** — start/stop agents, check status, deploy new ones, read logs. No GUI needed.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/harnesses` | List all harnesses with live Docker state |
| `GET` | `/api/harnesses/:id` | Single harness detail |
| `POST` | `/api/harnesses/:id/restart` | Restart (`{ mode: 'quick'\|'rebuild'\|'purge' }`) |
| `POST` | `/api/harnesses/:id/stop` | Stop |
| `POST` | `/api/harnesses/:id/start` | Start |
| `POST` | `/api/harnesses/restart-running` | Bulk quick-restart all running |
| `GET` | `/api/harnesses/:id/logs` | Container logs (`?lines=100`) |
| `GET` | `/api/harnesses/:id/models` | Model cascade config |
| `PUT` | `/api/harnesses/:id/models` | Update cascade (`{ cascade: [...] }`) |
| `POST` | `/api/harnesses/:id/duplicate` | Clone harness config (`{ name }`) |
| `POST` | `/api/setup/deploy` | Deploy new agent (full wizard payload) |
| `POST` | `/api/setup/detect` | Scan for Hermes compose directories |
| `GET` | `/api/keys` | List keys (masked, discovered from agent .env files) |
| `GET` | `/api/tools` | Tool registry (discovered from agent configs) |
| `GET` | `/api/memory-scopes` | Memory scopes per agent |
| `GET` | `/api/audit` | Audit log (`?who=&what=&since=`) |
| `GET/PUT` | `/api/settings` | App settings |

---

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** + **Lucide Icons**
- **Vitest** for testing (71 tests)
- Docker CLI (via shell) for container management
- AES-256-GCM key encryption at rest

---

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Default | Description |
|---|---|---|
| `HERMES_DIR` | — | Path to your existing Hermes docker-compose files |
| `DATA_DIR` | `~/.hermes-swarm-map` | Config, keys, audit logs, standalone compose files |

API keys are encrypted at rest. The encryption key is machine-local at `~/.hermes-swarm-map/.key`.

---

## License

MIT
