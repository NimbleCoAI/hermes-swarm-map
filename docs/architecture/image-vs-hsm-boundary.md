# Image vs HSM Boundary

Decision framework for contributors: when you build a new feature or fix, this doc tells you whether it belongs in the **Docker image** (hermes-agent) or in **HSM's scaffolding layer** (hermes-swarm-map).

## The Two Layers

### Docker Image (hermes-agent)

The immutable runtime. Code lives at `/opt/hermes/`, installed via Dockerfile. Ships to everyone who pulls from GHCR or Docker Hub.

- Changes require image rebuild + container restart
- Shared across all deployments — NimbleCo, upstream users, anyone pulling the image
- Repository: [NimbleCoAI/hermes-agent](https://github.com/NimbleCoAI/hermes-agent) (public fork of NousResearch/hermes-agent)

### HSM Scaffolding (hermes-swarm-map)

Per-deployment config, plugins, hooks, and skills installed into `/opt/data/` at agent creation time, and syncable onto already-created agents via `POST /api/harnesses/:id/artifacts/sync` (additive + no-clobber — see [Agent Updates](agent-updates.md)).

- Changes take effect on next agent create/duplicate, or via the artifacts-sync endpoint for existing agents
- Deployment-specific — each HSM instance can have different defaults
- Two creation paths: setup wizard (`app/api/setup/deploy/route.ts`) and harness service (`lib/services/harness.ts`)
- See also: [Opinionated Config Plan](../plans/opinionated-config.md) for implementation details of what HSM scaffolds

## Decision Framework

When deciding where a feature belongs, work through these questions in order. The first "yes" wins.

### 1. Is it a security boundary?

Approval system, path security, tirith policy, dangerous-command detection, URL safety.

**→ Image.** Security patterns must be immutable. They can't be optional, can't be overridden by config, and must ship to every deployment. If an operator can disable it by editing a config file, it's not a security boundary.

### 2. Does it depend on the deployment?

Needs `HSM_URL`, `HERMES_HOME_CHANNEL`, deployment-specific API keys, or knowledge of other agents in the fleet.

**→ HSM.** The image doesn't know what deployment it's running in. Anything that needs deployment context belongs in HSM scaffolding (plugins, hooks, env vars).

### 3. Is it core runtime?

Gateway, agent loop, CLI, tool implementations, platform adapters, session management.

**→ Image.** These are the engine. They must be consistent across deployments and tested as a unit.

### 4. Is it a safe default that operators might override?

Mention-gating, session reset timing, memory limits, model choices, compression settings.

**→ Both.** Set the safe default in image code (e.g., `TELEGRAM_REQUIRE_MENTION` defaults to `true` in the adapter). Expose the override in HSM's `.env` or `config.yaml` generation so operators can change it per-agent.

### 5. Is it a behavioral template?

Agent persona, startup checklist, personality, operational instructions.

**→ HSM.** `SOUL.md` and `BOOT.md` are per-agent. The image provides the machinery to read them; HSM provides the content.

### 6. Is it a plugin that integrates with HSM?

Multi-tenant policy, fleet-aware hooks, HSM API consumers.

**→ HSM.** Plugins like `swarm_map_policy` and `boot_md` need HSM to function. They're installed as baseline templates, not baked into the image.

## Fork Maintenance Heuristic

NimbleCoAI/hermes-agent is a fork of NousResearch/hermes-agent. Every feature that goes into the fork but not upstream increases maintenance cost — merge conflicts on the weekly upstream sync, divergent code paths, features that break when upstream refactors.

**The test:** Would this be useful to any Hermes user, or only NimbleCo deployments?

- **Useful to everyone** → upstream it (PR to NousResearch/hermes-agent) or cherry-pick to the public fork
- **NimbleCo-specific** → keep it in HSM scaffolding where possible (plugins, hooks, config). If it *must* be in the image (e.g., security fix), accept the fork cost
- **Experimental** → if it can be expressed through extension points (a plugin, a hook, a skill — no core edits), ship it as a **standalone, opt-in HSM artifact**: *not* in the image, and *not* in the default base bundle. Because it's unproven, it shouldn't ride the image everyone pulls or auto-load on every agent — install it per-agent to validate, then promote it (into the base bundle, or upstream) once proven. Only fall back to "carry it in the private fork" if it genuinely cannot be done without core edits.

**Current fork divergence:**
- Public fork removes ~25 upstream tools (platform-specific integrations not needed for NimbleCo)
- Public fork adds security fixes (admin-only approval gating, denial message improvements)
- Weekly upstream sync CI runs Mondays 6am UTC (`upstream-sync.yml`), auto-PRs clean rebases, opens issues on conflicts

## Current Inventory

### What's in the Image

| Category | Examples | Notes |
|----------|----------|-------|
| **Core runtime** | `hermes_cli/`, `agent/`, `gateway/`, `cron/`, `plugins/` | The engine |
| **Tools** | `approval.py`, `browser_tool.py`, `mcp_tool.py`, `terminal_tool.py`, ~80 total | Baked in, available to all agents |
| **Security** | `approval.py`, `tirith_security.py`, `path_security.py`, `url_safety.py` | Immutable security boundaries |
| **Built-in skills** | `skills/` (~90 across 25 categories) | Reference implementations, bundled |
| **System deps** | Python 3.13, Node.js, ripgrep, ffmpeg, Playwright | Runtime prerequisites |
| **Platform adapters** | Signal, Telegram, Mattermost, Slack, Discord, Matrix, DingTalk | Gateway adapters for each platform |
| **Safe defaults in code** | `REQUIRE_MENTION` defaults to `true`, `admin_only` defaults to `true` | Override via env vars |

### What HSM Scaffolds

| Category | Items | Notes |
|----------|-------|-------|
| **Plugins** | `swarm_map_policy` (multi-tenant access control), `boot_md` (startup checklist) | Depend on HSM_URL |
| **Hooks** | `lifecycle-notify` (startup notification to home channel) | Depends on HERMES_HOME_CHANNEL |
| **Skills** | `ocr-and-documents` (PDF/image text extraction) | Uses pymupdf from image |
| **Config files** | `.env`, `config.yaml`, `SOUL.md`, `BOOT.md`, `docker-compose.yml` | Per-agent, generated at creation |
| **Security defaults** | `HERMES_DM_POLICY=approved-only`, `HERMES_APPROVAL_ADMIN_ONLY=true`, `*_REQUIRE_MENTION=true` | Env vars that activate image-level features |
| **Docker hardening** | `read_only: true`, `cap_drop: ALL`, user 10000:10000, 2GB/2CPU limits | Compose-level security |

**Default bundle vs optional artifacts.** Not everything HSM *can* install is installed on every agent. The table above is the **default base bundle** — the sane, proven defaults every agent gets (see the *opinionated HSM base package* decision). HSM also hosts **optional / experimental artifacts** in the same `infra/templates/` tree that are installed **per-agent, opt-in** (a plugin enabled via `plugins.enabled`, a skill installed explicitly) and are deliberately kept *out* of the default bundle until validated. `human_escalation` (+ the `checkout` skill) is the first such optional artifact: an experimental human-in-the-loop purchasing capability — standalone, zero image footprint, not in the base bundle.

### The Boundary in Practice

```
┌─────────────────────────────────────────────────────┐
│ Docker Image (hermes-agent)                         │
│                                                     │
│  /opt/hermes/                                       │
│  ├── tools/approval.py    ← security boundary       │
│  ├── gateway/             ← platform adapters        │
│  ├── agent/               ← agent loop               │
│  └── skills/              ← bundled reference skills  │
│                                                     │
│  Code defaults:                                     │
│  • REQUIRE_MENTION = true (if env var not set)      │
│  • admin_only = true (in DEFAULT_CONFIG)            │
│                                                     │
├─────────────────────────────────────────────────────┤
│ HSM Scaffolding (hermes-swarm-map)                  │
│                                                     │
│  /opt/data/  (mounted volume)                       │
│  ├── .env                 ← deployment secrets       │
│  ├── config.yaml          ← model, compression, etc  │
│  ├── SOUL.md              ← agent personality         │
│  ├── BOOT.md              ← startup checklist         │
│  ├── plugins/             ← swarm_map_policy, boot_md │
│  ├── hooks/               ← lifecycle-notify          │
│  ├── skills/              ← ocr-and-documents         │
│  └── memories/            ← persistent memory store   │
│                                                     │
│  Env overrides:                                     │
│  • TELEGRAM_REQUIRE_MENTION=false (if you want it)  │
│  • HERMES_APPROVAL_ADMIN_ONLY=false (backwards compat)│
│                                                     │
└─────────────────────────────────────────────────────┘
```

## Examples

**"I fixed a bug in the approval system where denial messages don't include pattern info"**
→ Image. It's a security boundary fix. Cherry-pick to the public fork.

**"I want agents to send a startup message to their home channel"**
→ HSM. Needs `HERMES_HOME_CHANNEL` (deployment context). Ship as a hook in `infra/templates/hooks/`.

**"I want to add admin-only gating to the /approve command"**
→ Image (the check) + HSM (the config). The code that checks `admin_only` goes in `gateway/run.py` (image). The default `admin_only: true` goes in `DEFAULT_CONFIG` (image). HSM sets `HERMES_APPROVAL_ADMIN_ONLY=true` in `.env` as belt-and-suspenders.

**"I built a plugin that queries HSM for group membership"**
→ HSM. It's a plugin that depends on `HSM_URL`. Install via `infra/templates/plugins/`.

**"Agents should default to mention-gating in group chats"**
→ Both. Safe default in adapter code (`true` when env var unset). HSM exposes the toggle in `.env` and the UI.

**"I want agents to auto-solve CAPTCHAs during browser automation"**
→ HSM. The browser tool already returns `bot_detection_warning` (image). CAPTCHA solving depends on deployment-specific services (Camofox URL, CapSolver API key). Ship as a plugin (`captcha_cascade`) that registers a `captcha_solve` tool. The agent's skill teaches it when to call the tool. No fork changes needed — the image provides the detection, the plugin provides the resolution.

**"I want agents to complete purchases with a human in the loop (relay a 2FA code, confirm the charge)"**
→ HSM, standalone + experimental. Ship as a plugin (`human_escalation` — registers `escalate_to_human` + `check_pending_escalation` tools and a `pre_gateway_dispatch` resume hook) plus a `checkout` file skill, both under `infra/templates/`. It rides only existing extension points (tool registration, the dispatch hook, the `send_message` tool, session env vars) — **zero fork changes, no recurring rebase cost**. Because it's unproven *and* spends real money, it stays an **opt-in** artifact (not the base bundle) until validated on a real agent. Design note: it deliberately avoids a gateway patch — the escalation tool posts to chat and returns, and the hook rewrites the user's reply to resume — so the whole feature lives in `infra/templates/` with nothing in the image.

> **Skill packaging caveat.** A skill that should *auto-trigger* (appear in the agent's `<available_skills>` index from its `description`) must ship as a **file skill** at `infra/templates/skills/<name>/SKILL.md` (like `checkout`, `captcha-escalation`, `ocr-and-documents`). A plugin can also expose a skill via `ctx.register_skill(...)`, but those are **opt-in explicit loads only** — *not* indexed and *not* auto-triggered (see `hermes_cli/plugins.py` `register_skill`). Use `register_skill` for reference docs the agent loads on demand; use a file skill when user intent should trigger it.
