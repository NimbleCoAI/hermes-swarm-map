# Swarm-Map — Slim Rebuild

## What we're building
A slimmed-down redesign of Swarm-Map: the policy + orchestration layer that sits between chat surfaces and harness runtimes.

```
Chat surface (Telegram, Mattermost, …) → Harness (Hermes) → Tools / Memory
                                          ↑
                                  Swarm-Map governs this
```

This is a **foundation play**. Right now: Hermes harnesses, Telegram + Mattermost surfaces, single-user / small-team scenarios. Built so Discord/Slack/Signal and other harness types drop in cleanly later.

## First principles

1. **Modular by adapter.** UI says "Chat surface" generically. Adding Discord = a new adapter card. No IA shifts.
2. **Harness-agnostic vocabulary.** UI says "Harness," not "Hermes runtime." Hermes is the default; the abstraction holds.
3. **Bindings as first-class.** Keys, tools, and memory scopes can bind to multiple harnesses. Even if usage is light at launch, the affordance is built in.
4. **Habitat clamps capability.** Where a harness lives (sanctum / team / org / org+public / public) sets the ceiling on what tools and memory it can use *on that surface*. Same harness, two surfaces, two clamps.
5. **Opinionated > fiddly.** Lean clean. Don't pre-build the org/multi-tenant maze. Complexify when real users force it.
6. **Learn from testing.** Tier→tool/memory mapping has obvious patterns (web search = always dangerous, deletes = high). Don't pre-script edge cases.

## Runtime control: restart vs rebuild
Vibe-coders are editing harnesses like documents. Two modes, dead obvious:

- **Quick restart** — config reload (env, tools, prompt). Sub-second. Default.
- **Full rebuild** — docker rebuild + restart. 10-60s. When code/deps changed.

UI: single primary `↻ Restart` button on harness detail (auto-picks). Split menu exposes both explicitly. Inline pill states the runtime situation:
- "warm cache · 4m old"
- "rebuild needed · Dockerfile changed 2m ago" (amber)
- "rebuilding · 12s" (animated)

Plus a Cache widget showing layer cache size + "purge & rebuild" rescue button. Goal: never need a terminal.

## Cut

- NimbleCo harnesses (deadweight)
- OpenClaw runtime
- Pipelines
- Bearer-token-for-Claude-Code system → replaced by single local-API toggle
- DB-vs-env key split → one vault, sortable later
- Swarm and team stubs → not needed at this scope

## Keep & rebuild

- **Harnesses** — list, detail (logs/env/security/settings), start/stop/restart/duplicate/import/create
- **Chat surfaces** — Mattermost (one runtime per team, scope by channel + invoker), Telegram (DM allowlist + group-add allowlist)
- **Permissions** — who's admin (per-harness or global), budget caps for non-admins
- **Tool tiers** — registered tools, risk level, which tiers may use them
- **Keys** — flat vault with bindings to harnesses, rotation
- **Memory scopes** — siloed runtime vs tag-gated, mapped to habitat tier
- **Audit log**
- **Local API** — single toggle so local Claude Code can hit Hermes
- **Settings** — global config

## The core object: Harness

```
Harness
├── identity: name, type (hermes | claude-code-proxy | custom), parent? (inherits creds+tools)
├── status: running | stopped | proxy, health, today's cost & tool calls
├── surfaces: [{ adapter: 'telegram'|'mattermost', habitatTier, scoping rules }]
├── bindings: { tools[], keys[], memoryScopes[] }
└── invocation rules: who can talk to it (per surface)
```

## Habitat tiers (the spine)

Risk increases left → right:

| Tier | Example | Default tool ceiling | Default memory strategy |
|------|---------|---------------------|--------------------------|
| **Sanctum** | Solo, your home lab | All tools | Personal long-term |
| **Team** | High-trust group | All tools | Shared team memory |
| **Org** | Trusted but scoped | Most tools, some firewalls | Tag-gated by team/role |
| **Org + Public** | Internal + limited public surface | Curated subset | Tag-gated, public-walled |
| **Public** | Paid open API on Telegram | Read-only + safe writes | Siloed runtime, no carryover |

**Always-dangerous primitives** (red regardless of tier, just gated harder as you move right):
- Web search — LLMs read content as commands
- Code execution / sandboxes
- Deletes (in any tool)
- Unscoped memory writes

**Habitat clamps capability per surface.** Same harness can serve a sanctum DM and a public group; the public group surface gets the public clamp even though the harness has more available.

## Two visual directions

### A — Operator Console
Dense, technical, monospace-leaning. Status-tile dashboard with habitat/tier visualization as hero. For someone who lives in this app daily.

Type: JetBrains Mono (UI accents) + Inter Tight (body). Palette: charcoal, amber accent, signal red for danger.

### B — Calm Orchestrator
Editorial, more whitespace, status-as-narrative. Cards over tables, conversational copy. Reads like a thoughtful product, not a control panel.

Type: Inter (body) + a more editorial display face for headings. Palette: warm off-white, ink, sage accent.

Both: same IA, same data model, light/dark toggle, Tweaks panel.

## Information architecture

```
Dashboard          — at-a-glance: harness tiles, today's cost/calls, alerts
Harnesses          — list → detail (logs, env, security, settings, surfaces, bindings)
Surfaces           — chat-surface adapters; Telegram + Mattermost cards; "Add adapter" stub
Tools              — registered tools, tier assignment, risk
Keys               — vault, bindings, rotation
Memory             — scopes, strategy per scope, bindings
Permissions        — who's admin, budgets, tier×role matrix
Audit              — append-only log
Settings           — local API toggle, global config
```

## Tweaks (per-artboard)
- Theme: light / dark
- Density: compact / comfortable
- Direction emphasis: A / B (toggle within each artboard)
- Sample state: healthy / mixed / incident (changes mock data tone)

## v1 scoping — single-player local admin

Swarm-Map v1 ships as **a tool you run on your own machine to manage your own swarm.** Not multi-tenant. Not a SaaS admin suite. The person looking at the GUI *is* the admin.

What this means concretely:

- **People tab** is **just you for now** — your @handles across the surfaces you've connected (so we can echo "messages from @juni hit cryptid"). No invite flow. No role matrix.
- **Permissions are reduced to two tiers: admin (you) + everyone else (community).** "Operator/viewer" roles are bookmarked for v2.
- The interesting question of *which @handles can invoke which harnesses* is **per-harness**, not global. UX-undecided whether that lives on the harness page or the chat-surface page — leave both empty slots; A/B with real users.
- **Open-sourceable.** No multi-tenant assumptions baked in. Someone clones the repo, runs it locally, points it at their Hermes, and it works.

### What to defer to v2 (multiplayer admin suite)
- Per-handle role assignment (operator, viewer, etc.)
- Cross-surface handle reconciliation (@juni on Telegram == @juni on Mattermost)
- Invite flow / handoff
- Budget caps for non-admins
- The harness-vs-surface UX question for invocation rules


### v1 — what ships
- Harnesses (list, detail with logs/tools/surfaces/keys/memory/security/settings)
- Surfaces: Mattermost + Telegram, **key-based config + in-app guidance** for the parts that must happen in BotFather / MM admin
- Tools, Keys (flat vault, multi-habitat bindings), Memory scopes, People, Audit, Settings (Local API toggle)
- Calm default + Operator toggle

### Inline runtime controls (v1)
- Harness list rows expose **start / restart / stop** on hover (or always-visible in Operator).
- Topbar action: **Restart all running** — a one-shot for "I just edited shared config, bounce everything." This was a heavily-used real-world action.
- **Full rebuild** stays in harness detail only — destructive-ish (10–60s, busts cache), shouldn't be one-click on a list.

### Multi-model with priorities + fallbacks (v1)
- A harness has `models: []`, ordered. First = primary, rest = fallback chain.
- Detail header renders the stack as `primary › fallback › fallback`. List shows primary + `+N` chip.
- **Model gating** (admin setting): each model has `accessTier: 'open' | 'admin'`.
  - `open` — anyone the habitat allows (e.g. local Qwen).
  - `admin` — only admin invocations route through it (e.g. Claude). Non-admin invocations fall through to the next non-admin model in the stack.
- Marker: ◆ (admin-only) chip on model badges.
- Lives in **Settings → Model gating**, not per-harness, because the policy is org-wide.

### v2 — single-harness runtime view
Click into a harness → manage cron tasks, skills, MEMORY.md / USER.md, dangerous-command approvals, SSE streaming logs, mermaid renders, workspace browser. (Most of the Hermes-WebUI surface area lives **here**, not at the swarm level.)

The swarm-level views become **rollups + flow control** over those individual runtime views. You can drive any single harness like a focused workspace, or zoom out to compare/orchestrate the flock.

### v3 — OAuth integrations
Not Mattermost/Telegram (those genuinely need user setup in-app). Specifically for:
- LLM providers (Anthropic, OpenAI, Google) where they offer OAuth
- MCP services: Notion, Figma, Google, GitHub, etc. — where Claude.ai-style OAuth would replace a user pasting an API key

Until then, ship key-based to keep MVP clean.

### v3+ — internal chatbot
A swarm-map-native agent that can do complicated config on the user's behalf via the same API the GUI uses. The GUI itself becomes one of N clients.

### Hermes-webui prior art (bookmarked)
- Per-harness chat panel with SSE streaming
- Tasks (cron / scheduled invocations)
- Skills directory + MEMORY.md / USER.md context files
- Dangerous-command approval cards (inline in chat)
- Mermaid rendering for plans
- Workspace file browser

All of this is **single-harness runtime view** material → v2.
