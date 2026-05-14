# Hermes Swarm Map

Open-source admin GUI for orchestrating [Hermes](https://github.com/NousResearch/hermes-agent) agent harnesses across chat surfaces.

## Quick Start

```bash
pnpm install
pnpm seed        # populate with sample data
pnpm dev         # start at http://localhost:3000
```

## What It Does

- Discover and manage Hermes agent harnesses running in Docker
- Start, stop, restart (quick/rebuild/purge) harnesses
- Manage API keys, tool registries, memory scopes, model fallback chains
- Visualize habitat tiers and tool risk across the fleet
- Audit all administrative actions

## Stack

Next.js 14 · TypeScript · Tailwind CSS · shadcn/ui · Lucide Icons

## Configuration

Copy `.env.example` to `.env` and set:

- `HERMES_DIR` — path to your Hermes docker-compose files
- `DATA_DIR` — where Swarm Map stores config (default: `~/.hermes-swarm-map`)

## License

MIT
