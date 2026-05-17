<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Agent Guide — Hermes Swarm Map

## What It Is

Hermes Swarm Map is an open-source admin GUI for orchestrating Hermes agent harnesses. It lets you discover, create, configure, start/stop/restart, and audit Hermes agents running in Docker — including managing API keys, tool registries, model fallback chains, and memory scopes across the fleet.

## Architecture

**Next.js 14 fullstack monorepo.** API routes live in `app/api/` and shell out to Docker via the service layer. There is no separate backend process — the Next.js server IS the backend.

**Data lives in `~/.hermes-swarm-map/`** (configurable via `DATA_DIR` env var). This directory holds per-harness configs, the encryption key, and audit logs. It is not in the repo.

**Agents are discovered from Docker.** The app scans running containers and compose files for Hermes markers. Existing compose files that weren't created by Swarm Map are read-only — they are never modified.

**New agents get standalone compose files.** When you create an agent via the wizard, it gets its own `~/.hermes-swarm-map/compose/{name}/docker-compose.yml`. This is the only compose file Swarm Map ever writes.

## Key Patterns

### Hermes Detection

A container or compose service is a Hermes agent if it matches any of:
- `command: gateway` in the compose service definition
- A volume mount targeting `/opt/data`
- `x-hermes` anchors in the compose YAML
- `HERMES_REPO_URL` environment variable

### Port Allocation

Ports are never hardcoded. The service scans Docker for all currently used ports, finds the highest in the Hermes range (base: 8642), and increments by 10 for each new agent. Never assign ports manually.

### Image Fallback

New agents try `nousresearch/hermes-agent:latest` from Docker Hub first. If unavailable, the service falls back to a local build. This is handled in `lib/services/harness.ts` — don't bypass it.

### Key Encryption

All sensitive values (API keys, tokens) are encrypted at rest using AES-256-GCM. The encryption key lives at `~/.hermes-swarm-map/.key` and is machine-local. Never expose raw key values in API responses or logs. The `EncryptionService` (`lib/services/encryption.ts`) handles all encrypt/decrypt operations.

### Model Cascade

Each harness has an ordered fallback chain of LLM providers/models. This is stored in the agent's `config.yaml` under `~/.hermes-{name}/`. The cascade is configured via the Models tab in the GUI and managed by `lib/services/config.ts`.

### Agent Data Directories

Each agent gets `~/.hermes-{name}/` containing:
- `.env` — environment variables (encrypted values written here)
- `config.yaml` — model cascade, harness settings
- `SOUL.md` — agent persona/instructions
- `memories/` — agent memory files

## Project Structure

```
hermes-swarm-map/
├── app/
│   ├── (dashboard)/          # Main app pages (harnesses, keys, tools, etc.)
│   │   ├── harnesses/        # Fleet overview + per-harness detail
│   │   ├── keys/             # API key management
│   │   ├── memory/           # Memory scope browser
│   │   ├── tools/            # Tool registry
│   │   ├── audit/            # Audit log viewer
│   │   └── settings/         # App settings
│   ├── (setup)/              # Onboarding/wizard pages
│   │   └── setup/wizard/     # New agent creation wizard
│   ├── api/                  # API routes (shell out to service layer)
│   └── layout.tsx            # Root layout
├── lib/
│   ├── services/             # Core service layer (see below)
│   │   └── __tests__/        # Vitest tests for services
│   ├── types.ts              # Shared TypeScript types
│   ├── utils.ts              # Shared utilities
│   ├── constants.ts          # App-wide constants
│   └── seed.ts               # Dev seed data script
├── components/
│   ├── harness/              # Harness-specific UI components
│   ├── ui/                   # Base UI primitives (shadcn)
│   ├── shell/                # Layout chrome (nav, sidebar)
│   └── wizard/               # Setup wizard components
├── bin/                      # Shell scripts (dev startup, etc.)
├── scripts/                  # Build/utility scripts
└── handoff/                  # ARCHIVED — historical design docs (see handoff/ARCHIVED.md)
```

## Service Layer

All business logic lives in `lib/services/`. API routes are thin — they call services, not the other way around.

| Service | File | What It Does |
|---|---|---|
| `HarnessService` | `harness.ts` | Create, start, stop, restart, delete harnesses; compose file management |
| `DockerService` | `docker.ts` | Exec Docker CLI commands, parse container/compose state, port scanning |
| `KeysService` | `keys.ts` | Store and retrieve encrypted API keys per harness |
| `ToolsService` | `tools.ts` | Tool registry — list, enable/disable tools per harness |
| `MemoryService` | `memory.ts` | Browse and manage agent memory scopes |
| `AuditService` | `audit.ts` | Append-only audit log for all admin actions |
| `ConfigService` | `config.ts` | Read/write per-harness config.yaml (model cascade, settings) |
| `EncryptionService` | `encryption.ts` | AES-256-GCM encrypt/decrypt, key loading from `~/.hermes-swarm-map/.key` |
| `StorageService` | `storage.ts` | Low-level file I/O for `~/.hermes-swarm-map/` data directory |

## Running Locally

```bash
pnpm install
pnpm seed        # populate with sample/dev data
pnpm dev         # starts at http://localhost:3000
```

`pnpm dev` runs `bin/dev.sh` which may do environment prep before launching Next.js. Use `pnpm dev:raw` to skip the shell wrapper and run Next.js directly.

## Testing

```bash
pnpm vitest run
```

71 tests across 12 test files in `lib/services/__tests__/`. All tests must pass before committing. Tests use `vitest` with `jsdom` environment — no real Docker or filesystem calls in unit tests (services are mocked).

## What NOT To Do

- **Never modify shared compose files** — files not created by Swarm Map are read-only. If you need to change harness config, write to the standalone compose at `~/.hermes-swarm-map/compose/{name}/`.
- **Never expose raw key values** — `KeysService` always returns encrypted blobs or masked values for display. API responses must not contain plaintext secrets.
- **Never hardcode port numbers** — always use the port allocation logic in `DockerService`. Hardcoded ports cause conflicts across harnesses.
- **Never write directly to `~/.hermes-{name}/`** — go through `ConfigService`, `KeysService`, or `MemoryService`. Direct file writes bypass encryption and audit logging.
- **Never bypass `EncryptionService`** — all sensitive values at rest must be encrypted. Writing plaintext to `.env` files breaks the security model.
