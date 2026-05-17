# Hermes Swarm Map

Open-source admin GUI for orchestrating [Hermes](https://github.com/NousResearch/hermes-agent) agent harnesses. Discover, create, configure, start/stop/restart, and audit Hermes agents running in Docker — including API key management, tool registries, model fallback chains, and memory scopes across your fleet.

---

## What You See

The dashboard shows your full agent fleet: running status, habitat tier, tool count, and last activity per harness. Drill into any agent to manage its keys, model cascade, tools, memory scopes, and audit history. The setup wizard walks you through creating a new agent from scratch.

---

## Quick Start

```bash
pnpm install
pnpm seed        # populate with sample data (first run only)
pnpm dev         # http://localhost:3000
```

If you've already seeded, just run `pnpm dev`.

---

## Deploy to Remote (Mac Mini / Linux Server)

```bash
pnpm build
pnpm start -- --hostname 0.0.0.0
```

This binds to all interfaces so the GUI is reachable from other machines on the network. Run behind nginx or Tailscale if you need HTTPS or access outside your LAN.

---

## Creating a New Agent

Navigate to `/setup/wizard` in the GUI. The wizard walks through:

1. Name and description
2. Chat surface (which channel the agent serves)
3. Model cascade (ordered LLM fallback chain)
4. Tool selection and permissions
5. Initial SOUL.md (persona/instructions)

The wizard writes a standalone compose file to `~/.hermes-swarm-map/compose/{name}/docker-compose.yml` and starts the container.

---

## Stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** + **shadcn/ui** + **Lucide Icons**
- **Vitest** for testing
- Docker CLI (via shell) for container management

---

## Configuration

Copy `.env.example` to `.env` and set:

| Variable | Default | Description |
|---|---|---|
| `HERMES_DIR` | — | Path to your existing Hermes docker-compose files (read-only discovery) |
| `DATA_DIR` | `~/.hermes-swarm-map` | Where Swarm Map stores config, keys, and audit logs |

Sensitive values (API keys) are encrypted at rest with AES-256-GCM. The encryption key is machine-local at `~/.hermes-swarm-map/.key`.

---

## License

MIT
