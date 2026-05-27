# Hermes Swarm Map
A commons, public goods project of [NimbleCo](https://www.nimbleco.ai/). 

**Multiplayer admin and orchestrator platform for Hermes.** Deploy, manage, and monitor multiple [Hermes Agent](https://github.com/NimbleCoAI/hermes-agent) instances from one dashboard — with built-in multi-tenant security, model cascades, and platform connections.

*First of its kind, a point and click GUI for not just managing Hermes runtimes, but also who can do what and where. Solves the multi-tenant Hermes problem. View the godhead of complexity without derealizing. Share compute.*

<img width="1352" height="763" alt="Screenshot 2026-05-26 at 5 01 19 pm" src="https://github.com/user-attachments/assets/4b94f0d1-d9b8-4a81-8b47-b2dae1940741" />
*Calm UX showing a variety of config settings for different hermes harness runtimes*

---

## Why Hermes Swarm Map?

AI agents are most useful when they're always on — running on a server, reachable from your phone, remembering context across conversations. But running *multiple* agents across *multiple* platforms for *multiple* users? That's where it gets hard.

Hermes Swarm Map is the control plane. One UI to deploy, configure, and manage a fleet of Hermes agents — each with its own personality, memory, platform connections, and budget. Everything a single agent can do, but multiplied and multiplayer.

## What People Build With It

**The indie hacker** runs 3 agents: a customer support bot on Telegram, a research assistant on Signal, and a coding helper via API. Each has its own model cascade (Claude for complex tasks, Gemini Flash for quick ones), its own budget cap, and its own personality. HSM manages all three from one dashboard.

**The small team** gives each team member their own AI assistant on Mattermost. Memory is scoped per-channel — what the engineering channel discusses stays there. The team lead manages API keys, monitors costs, and approves new group connections from HSM.

**The AI researcher** runs 8 specialized agents across Signal and Telegram for different research domains. HSM handles group approval policies, model fallback chains, and cost tracking across the fleet. New agents deploy in minutes via the wizard.

## What You Get

🧙 **Setup Wizard** — Deploy a new agent in 5 clicks. Opinionated defaults for compression, memory, security, and voice transcription so it works out of the box.

🔀 **Model Cascade** — Ordered fallback chains across providers. Start with Claude, fall back to Gemini, fall back to local Ollama. Per-agent.

🔐 **Multi-Tenant Security** — Per-context memory isolation, group approval policies, admin-only commands, encrypted API keys. Each conversation thread is a walled garden.

📊 **Fleet Dashboard** — See all your agents at a glance. Health, costs, session counts, model usage. Stop, restart, or rebuild any container from the UI.

🔌 **Platform Connections** — Connect agents to Signal, Telegram, Mattermost, or expose them via API. Manage surfaces from the UI.

💰 **Budget Enforcement** — Set monthly spend limits per API key. Agents self-throttle when budget is exceeded.

---

## Quick Start

```bash
git clone https://github.com/NimbleCoAI/hermes-swarm-map.git
cd hermes-swarm-map
npm install
npm run seed      # first run: writes settings + tier config
npm run dev       # http://localhost:3000
```

On first launch, the setup wizard detects your Hermes compose directories automatically. Point it at your agent directory and go.

**New here?** Read the [Getting Started guide](docs/getting-started.md) for a full walkthrough.

### Requirements

- **Node.js 18+**
- **Docker** running locally (used for container management)
- **Hermes Agent** instances — see [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

---

## Features

- **Discovery** — auto-detect Hermes agent containers and compose files
- **Per-agent configuration** — edit env vars, SOUL.md personas, surface connections
- **Model cascade** — ordered fallback chains across providers (Anthropic, OpenAI, Bedrock, etc.)
- **Surface management** — connect agents to Telegram, Signal, Mattermost
- **Restart / rebuild / purge** — container lifecycle via UI or API
- **Policy enforcement** — group access control, DM approval gating, admin resolution
- **Agent creation wizard** — scaffold and deploy new agents from the UI
- **API key management** — AES-256-GCM encrypted at rest
- **Audit log** — track who changed what and when

<img width="911" height="742" alt="Screenshot 2026-05-27 at 3 27 31 pm" src="https://github.com/user-attachments/assets/68a7f594-4e17-419a-8cb6-180b94cac40a" />

<img width="680" height="686" alt="Agent creation wizard" src="https://github.com/user-attachments/assets/62ff24dc-d266-4c18-9542-038ac1b09eaa" />

---

## Running on a Remote Server

Build once, run in production mode:

```bash
npm run build
npx next start --port 3000 --hostname 0.0.0.0
```

Access from any machine on the network at `http://<hostname>:3000`. Run behind nginx or Tailscale for HTTPS or external access.

Set `ALLOWED_DEV_ORIGINS` in `.env` for dev mode on remote machines (see Configuration).

---

## Architecture

<img width="1023" height="724" alt="Screenshot 2026-05-27 at 2 50 56 pm" src="https://github.com/user-attachments/assets/a2ad3118-81a2-433a-ae02-289546e7e02d" />

- **Next.js 14** (App Router) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** + **Lucide Icons**
- **Docker CLI** (via shell) for container management
- **Vitest** for testing
- **AES-256-GCM** key encryption at rest
- File-based agent config at `~/.hermes-swarm-map/`

---


## API Reference

Any AI agent (Claude Code, Hermes, etc.) can orchestrate your fleet via the REST API — no GUI needed.

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
| `GET` | `/api/keys` | List keys (masked, from agent .env files) |
| `GET` | `/api/tools` | Tool registry (from agent configs) |
| `GET` | `/api/memory-scopes` | Memory scopes per agent |
| `GET` | `/api/audit` | Audit log (`?who=&what=&since=`) |
| `GET/PUT` | `/api/settings` | App settings |

```bash
# Examples
curl http://localhost:3000/api/harnesses
curl -X POST http://localhost:3000/api/harnesses/h_myagent/restart \
  -H "Content-Type: application/json" -d '{"mode":"quick"}'
curl http://localhost:3000/api/harnesses/h_myagent/logs?lines=50
```

---

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Default | Description |
|---|---|---|
| `HERMES_DIR` | — | Path to your existing Hermes docker-compose files |
| `DATA_DIR` | `~/.hermes-swarm-map` | Config, keys, audit logs, standalone compose files |
| `PORT` | `3000` | Port for the Swarm Map UI |
| `ALLOWED_DEV_ORIGINS` | — | Comma-separated hostnames for remote dev access |

Settings are stored at `~/.hermes-swarm-map/settings.json`. API keys are encrypted at rest with a machine-local key at `~/.hermes-swarm-map/.key`.

---

## Documentation

- [Getting Started](docs/getting-started.md) — deploy your first agent in 5 minutes
- [Migrating Existing Agents](docs/migrating.md) — upgrade path for existing Hermes users
- [Platform Setup](docs/platforms.md) — Signal, Telegram, Mattermost, Google Workspace guides
- [Roadmap](docs/ROADMAP.md) — what's shipped and what's next
- [Contributing](CONTRIBUTING.md) — development setup and PR process
- [Architecture](AGENTS.md) — service layer, patterns, and agentic development guide

---

## License

[AGPL v3](LICENSE). You can use, modify, and deploy this software freely. If you modify it and expose it over a network (e.g., as a hosted service), you must make your modified source code available under the same license. Self-hosting for your own agents requires no source disclosure.
