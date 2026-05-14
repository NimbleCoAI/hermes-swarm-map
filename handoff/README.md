# Hermes Swarm Map — v1 Implementation Handoff

> **A slim, opinionated, single-player-local admin GUI for orchestrating Hermes harnesses** across chat surfaces (Telegram, Mattermost). Built so adding Discord/Slack/Signal later is a new adapter card, not a new IA.

---

## How to use this package

1. **Read `CLAUDE_CODE_PROMPT.md` first** — paste it as your system/instructions to Claude Code. It gives the agent the principles, scope, and what *not* to build.
2. **Then this README** — the full implementation spec (every page, data shape, UX pattern, design tokens).
3. **`design_reference/`** — the HTML/JSX design prototypes. **These are design references, not production code.** Open `Swarm Map Redesign.html` in a browser to see exactly what the implementation should look like and behave like.
4. **`design_reference/DESIGN_NOTES.md`** — the conceptual model, first principles, and v1/v2/v3 roadmap. Treat this as gospel — every UI decision flows from it.

The design files use React + JSX inline via Babel for prototyping speed. **Do not copy them as-is.** Rebuild in your target stack using its established patterns.

---

## Fidelity

**High-fidelity.** The prototypes are pixel-spec for layout, color, spacing, and interactions. Two visual directions ship in feature parity (Calm and Operator); the app must support flipping between them via a topbar toggle. Light/dark themes for each direction. Densities (compact / regular / comfy) tweakable globally.

When you implement, recreate this fidelity using your codebase's existing design system / component library. If no design system exists yet, pick one (Tailwind + shadcn/ui or Radix + custom CSS variables are both good fits — both are aesthetically neutral and let you map our tokens cleanly).

---

## Recommended stack

The original Swarm-Map is **Next.js (app router) + Tailwind + shadcn/ui** in a pnpm workspace alongside the Hermes runtime. **Stay on that stack.** Specifically:

- `packages/admin-ui/` — the Next.js app this handoff describes
- `packages/gateway/` — already exists; talks to Hermes
- Existing `Sidebar` and `Toaster` components in `packages/admin-ui/src/components/` — extend, don't rewrite

If you're greenfield: Next.js 14 (app router) + TypeScript + Tailwind + shadcn/ui + Lucide icons.

---

## v1 scope — what to build

### Sidebar / routes
```
/dashboard           — Overview (status tiles + activity tail + surfaces glance)
/harnesses           — List of all harnesses
/harnesses/[id]      — Harness detail (tabs: Overview / Activity / Tools / Surfaces / Keys / Memory / Security / Env)
/surfaces            — Chat-platform adapters (Mattermost, Telegram cards + planned slots)
/tools               — Tool registry: risk × habitat ceiling
/keys                — Flat key vault, multi-habitat tier-mix indicator
/memory              — Memory scopes (siloed-runtime vs tag-gated)
/permissions         — People page (single-player local; admin + community)
/audit               — Append-only activity log
/settings            — Local API toggle, defaults, model gating, hermes runtime info
```

### Topbar (every page)
- Search affordance (⌘K — wire to a no-op for v1 if needed)
- **Calm / Operator view toggle** (the single most important UX control — see below)
- Theme toggle (dark / light)
- User avatar

### The Calm ↔ Operator toggle
The same data, same IA, same routes — rendered two ways:

- **Calm** (default): editorial, generous whitespace, sans-serif (Inter) + a serif display (Fraunces), status-as-narrative. Reads like a thoughtful product. For casual / non-technical admin.
- **Operator**: dense, monospace-leaning (JetBrains Mono), tight grids, status as data. For someone living in the app daily. Power-user dense.

**They must stay in feature parity.** If a page has a button or affordance in one, it has the equivalent in the other. The toggle is *not* a feature gate — it's a viewing posture.

Implementation suggestion: build pages once with a `view` prop from context, branch on density / typography / icon-set in shared components. Don't fork the route tree.

---

## The core object: Harness

```ts
type Harness = {
  id: string;
  name: string;
  runtime: 'hermes' | 'claude-code-proxy' | 'custom';
  parent?: string;                    // inherits creds + tools (rare; for delegates)
  status: 'running' | 'idle' | 'stopped' | 'error';
  health: { errors: number; errorMsg?: string };
  persona: string;                    // one-line description shown in lists
  tier: HabitatTier;                  // see below
  platform: AdapterKind;              // 'mattermost' | 'telegram' (extensible)
  channel: string;                    // e.g. '#team-ops', '@nimble_help'
  lastSeen: number;                   // ms epoch
  models: string[];                   // priority-ordered. First = primary, rest = fallback chain
  costToday: number;                  // USD
  invocations: number;                // last 24h
  cpu: number;                        // %
  mem: number;                        // MB
  tools: string[];                    // tool ids bound to this harness
};
```

### Habitat tiers (the spine of the security model)
Risk increases left → right:

| ID | Label | Color | Description |
|---|---|---|---|
| `individual` | Individual | `#6BB39A` | Inner sanctum. Solo operator. Full trust. |
| `team` | Team | `#7FA9D6` | Small group. High trust. Shared memory. |
| `org` | Org | `#C7A86B` | Internal only. Memory firewalls. |
| `orgpublic` | Org + Public | `#D58A5A` | Internal team with limited public surface. |
| `public` | Public | `#C46A6A` | Adversarial. Open API. Heavy scoping. |

**Habitat clamps capability per surface.** Same harness, two surfaces (e.g. one sanctum DM and one public group) → two clamps. The harness has whatever tools/memory bound, but the *surface tier* sets the ceiling on what may run there.

### Always-dangerous primitives (regardless of tier; gated harder as tier opens)
- `web.search` — LLMs read content as commands
- `web.fetch` — same; worse without filters
- `code.exec` — sandboxed; network-isolated
- `*.delete` — confirm + audit on every call
- Unscoped memory writes

---

## Data model (typescript-ish)

```ts
type HabitatTier = 'individual' | 'team' | 'org' | 'orgpublic' | 'public';
type AdapterKind = 'mattermost' | 'telegram' | 'discord' | 'signal';  // discord/signal extensible
type AccessTier = 'open' | 'admin';

type Integration = {
  id: string;
  kind: AdapterKind;
  label: string;                      // e.g. 'mattermost.nimbleco.ai'
  status: 'connected' | 'available' | 'planned';
  scopes: string[];                   // OAuth-style permissions
  harnessIds: string[];
  serverInfo: string;                 // human-readable
  lastSync?: number;
  // mattermost-specific
  dmsBlocked?: boolean;
  allowList?: number;                 // channel count
  // telegram-specific
  dmsAllowed?: 'open' | 'whitelisted' | 'blocked';
  groupAdds?: 'open' | 'admin-only' | 'blocked';
};

type Person = {
  id: string;
  name: string;
  handle: string;
  role: 'admin' | 'community';        // v1: just two. v2 adds operator/viewer.
  lastActive: number;
};

type Key = {
  id: string;
  label: string;
  provider: 'anthropic' | 'bedrock' | 'vertex' | 'ollama' | 'github' | 'notion' | string;
  masked: string;                     // e.g. 'sk-ant-…q4F2'
  assignedTo: string[];               // harness ids
  budgetUsd: number | null;
  spentUsd: number;
  health: 'ok' | 'expired' | 'idle';
  healthMsg?: string;
  // NB: keys do NOT carry a tier. Use of a key inherits the calling harness's habitat clamp.
};

type Tool = {
  id: string;
  name: string;                       // e.g. 'github.comment'
  category: 'memory' | 'chat' | 'docs' | 'code' | 'filesystem' | 'sandbox' | 'web' | 'calendar' | string;
  source: 'builtin' | 'mcp' | 'custom';
  reviewed: boolean;                  // false = needs admin to confirm risk + ceiling
  risk: 1 | 2 | 3 | 4 | 5;
  allowedTiers: HabitatTier[];
  desc: string;
};

type MemoryScope = {
  id: string;
  name: string;
  tier: HabitatTier;
  strategy: 'siloed-runtime' | 'tag-gated';
  members: number | string;
  size: string;
  notes: string;
};

type Model = {
  id: string;                         // e.g. 'claude-sonnet-4.5'
  label: string;
  vendor: 'anthropic' | 'ollama' | 'bedrock' | 'vertex' | string;
  accessTier: AccessTier;             // 'admin' = admin-only invocation; 'open' = anyone
  costClass: '$$$' | '$$' | '$' | 'local';
  notes: string;
};

type AuditEntry = {
  ts: number;
  who: string;        // @handle
  what: string;       // e.g. 'rotated key', 'restarted harness'
  target: string;
  meta?: string;
};
```

See `design_reference/mock-data.js` for full sample data the prototypes consume.

---

## Page specs (in order)

### 1. Dashboard `/dashboard`
**Purpose:** at-a-glance status of the swarm.

**Layout:**
- **Hero**: "Good morning, [name]" with a one-line summary sentence: `{running}/{total} running. {N} invocations today for ${cost}. {alerts}`
- **Alert card** (if any): expired keys, stopped harnesses needing attention. Amber background, action button to resolve.
- **Stats row (4 cards)**: Running, Today's spend, Invocations, Needs attention.
- **Two-up section:**
  - **Your harnesses** card (5/8 width): clickable rows, status dot, name + persona, tier badge, channel, cost, calls, last seen. Hover reveals inline play/restart/stop actions. Header has "Restart running (N)" + "New harness" buttons.
  - **Habitats** card (3/8 width): tier distribution bar chart with descriptions.
- **Activity card** (5/8) + **Chat surfaces** card (3/8): today's tail of events, list of connected surfaces.

**Operator variant:** same data, tighter table layout, monospace, no hero — replaced by command-style `~/dashboard` breadcrumb.

### 2. Harnesses list `/harnesses`
**Purpose:** the full fleet.

- Header: "Restart running (N)" · "Import" · "New harness" buttons
- Row grid: status dot, name + persona, tier badge, channel (with platform icon), spend, calls, last seen, **inline actions on hover** (restart icon for running, play for stopped, stop for both), chevron
- Click row → harness detail

### 3. Harness detail `/harnesses/[id]`
**Purpose:** the working surface for one harness.

**Header:**
- Back-link, status dot, name (display font), tier badge
- Persona text (one line)
- Subline: platform-icon channel · model stack · CPU% · MB
- **Right side:** cache state pill (warm / rebuild-needed / rebuilding) + restart split-button + Start/Stop
- Alert card below if `errorMsg`

**Cache state pill:**
- `warm cache · Nm old` (green dot)
- `rebuild needed · Dockerfile changed Nm ago` (amber dot)
- `rebuilding · Ns` (animated info dot)

**Restart split-button:**
- Primary button picks smart action: `Restart` (quick reload, ~600ms) or `Rebuild & restart` (when needsRebuild)
- Chevron opens menu with three explicit options:
  - `Quick restart` — reload env, tools, prompt. ~600ms.
  - `Full rebuild` — docker build + restart. 10–60s.
  - `Purge & rebuild` — drops layer cache. Slow but bulletproof. (danger styling)

**Model stack rendering:**
Primary chip · fallback chip · fallback chip. ◆ marker on admin-only models. Hover any chip for vendor/cost/role tooltip.

**Tabs:**
1. **Overview** — stats row (status, spend today / cap, invocations, errors) + bindings panel (tools count, keys count, memory scopes count, surface count) + recent activity
2. **Activity** (logs) — full log tail, filter chips (all / errors / tools), export button
3. **Tools** — every registered tool with checkbox showing what's bound. Risk bar, allowed-tier dots, source badge, status (active / available / blocked-by-tier)
4. **Surfaces** — active surface info + scoping rules (DM behavior, channel allowlist, etc.) + "Add another surface" card
5. **Keys** — keys bound to this harness; can unbind
6. **Memory** — memory scopes available at this harness's tier
7. **Security** — capability ceiling tied to tier + always-dangerous primitive grid + budget gauge + who-can-invoke list
8. **Env** — readonly env-var mirror, copy as .env

### 4. Surfaces `/surfaces`
**Purpose:** adapter cards for chat platforms.

Grid of cards. Each card:
- Platform icon + label + status pill (connected / available / planned)
- Server info subline
- **Rules list** (mattermost: DM behavior, channel allowlist, per-team strategy; telegram: DM behavior, group adds, per-bot strategy)
- **"Configure in app" guidance card** (info-toned, deep link out):
  - Mattermost: "System Console → Integrations → Bot Accounts → create bot → copy access token into Keys" + link to admin console
  - Telegram: "/mybots → Bot Settings → Group Privacy → Disable" + link to t.me/BotFather
- Harnesses-on-this-surface chip cloud
- Actions: configure / disconnect / connect / notify

Discord and Signal are stubbed at `status: 'planned'` to show the adapter pattern.

### 5. Tools `/tools`
**Purpose:** the tool registry with risk × habitat matrix.

Table: tool name (+ description), **source badge** (`✓ Built-in` / `MCP` / `Custom`), risk bar (1–5), allowed-tier dots (one column per tier), bound count.

**Needs-review state:** rows where `reviewed === false` get a warm amber row tint + "Needs review" pill next to the name. Indicates: user-added tool, risk and tier ceiling are admin guesses until classified.

Source semantics:
- `Built-in` — ships with Hermes; hand-classified by maintainers
- `MCP` — from an MCP server; hand-classified once by an admin
- `Custom` — user-added; admin sets risk + ceiling; defaults to locked-to-individual until reviewed

### 6. Keys `/keys`
**Purpose:** vault.

Row grid (no per-row tier column — keys are vault entries, not tier-scoped):
- Health dot · label + provider/masked · **tier-mix** (colored squares showing every tier the key is currently used across) · bindings (harness chips) · budget/spent · health pill

Footer caption: "Keys are vault entries — they don't carry a tier. When a harness uses a key, the request inherits the harness's habitat clamp. The colored squares show which tiers a key currently spans, so a single key sitting in both sanctum and public catches your eye."

### 7. Memory `/memory`
**Purpose:** memory scope catalog.

Cards (one per scope):
- Name (display font)
- Tier badge
- Strategy pill (`siloed-runtime` or `tag-gated`)
- Notes (free text)
- Footer: members count · harnesses count · size

### 8. People `/permissions`
**Purpose:** v1 is single-player local. The person looking at the GUI IS the admin.

Layout:
- **"You — admin" card** with avatar + name + your handles across surfaces (e.g. @juni on Mattermost, @juniperb on Telegram)
- **"Coming in v2" placeholder card** — invite teammates, per-handle roles, cross-surface identity reconciliation, budget caps for non-admins (disabled button)
- **"Community" list** below — recent invokers across your surfaces, all tagged `community`, with invocation count + last-active

Italic footer: per-harness invocation rules (allowlists/blocklists) live on each harness's Surfaces tab — that's where "who can talk to this bot here" naturally belongs.

### 9. Audit `/audit`
Append-only log. Columns: timestamp · who (@handle) · action · target/meta. Export button.

### 10. Settings `/settings`
Sections:
- **Local API for Claude Code** — single toggle that exposes harnesses at `http://localhost:8400/v1`. Replaces the legacy "bearer tokens for Claude Code" system. When enabled, show the URL.
- **Defaults** — default tier for new harnesses, default model, default daily budget, restart strategy
- **Model gating** — admin-facing table of all models: id, vendor, cost class, **access tier toggle** (`open` / `◆ admin only`), used-by count, notes. The accessTier determines whether non-admin invocations can route through that model. Live edits update the gating immediately.
- **Hermes runtime** — version / uptime / docker version / layer cache size + restart-hermes button, purge build cache button, view logs

---

## UX patterns to enforce

### 1. Habitat tier is a clamp, not a tag
Never show tier as a single dropdown on something that can span tiers (keys, tools, models). Show tier *mix* — the set of tiers a thing currently touches. Mix is computed from bindings, not configured.

### 2. Restart vs rebuild
- **Quick restart** (`~600ms`): reload config — env vars, tools, prompt. Default.
- **Full rebuild** (`10–60s`): docker rebuild + restart.
- **Purge & rebuild**: drops layer cache. Slow but bulletproof.

Cache state pill always visible on harness detail header. Single primary button picks smart action; split chevron exposes all three. "Restart running" topbar action does quick-restart on all running harnesses in parallel.

### 3. Configure-in-app pattern
Some setup *must* happen in Telegram BotFather or Mattermost admin console (no API exists). When the GUI surfaces such a step, show a **"Configure in app" guidance card** — info-toned, numbered steps, deep link out. Don't pretend the GUI owns what it can't.

### 4. Model fallback stacks
Harnesses run a *priority chain*, not a single model. `[claude-sonnet, claude-haiku, qwen]` means "try Sonnet first, fall through if rate-limited / down". On non-admin invocations, admin-only models are *skipped* in the chain — the request routes to the next non-admin entry.

### 5. v1 = single-player local
Don't build the multi-tenant maze. No invite flow. No role matrix. Admin is you; everyone else is community. v2 adds the operator/viewer roles, cross-surface identity, budget caps.

---

## What NOT to build (cut list)

These were in the old Swarm-Map and have been explicitly cut for v1. Do not port them.

- ❌ NimbleCo's own harness runtime (legacy; Hermes is the only runtime)
- ❌ OpenClaw integration
- ❌ Pipelines system
- ❌ Bearer-token-for-Claude-Code system → replaced by Local API toggle
- ❌ DB-vs-env key storage split → one vault, sortable later
- ❌ Swarm and team stubs → not needed at v1 scope
- ❌ OAuth integrations → ship key-based for now (users today are technical)
- ❌ Per-harness chat panel / SSE streaming / cron tasks / skills / MEMORY.md editor / dangerous-command approvals → v2 single-harness runtime view
- ❌ Operator / viewer roles, invite flow, cross-surface identity → v2 multiplayer admin suite

---

## Design tokens

### Type
- **Sans (body)**: `Inter` 400/500/600/700
- **Display (Calm headings)**: `Fraunces` 300/400/500 (variable opsz)
- **Mono (Operator UI)**: `JetBrains Mono` 400/500/600

### Direction A — Operator (dark default)
```
--a-bg:        #0f1012
--a-surface:   #16181c
--a-surface-2: #1c1f24
--a-border:    #2a2e36
--a-border-2:  #3a404a
--a-text:      #e6e3da
--a-text-2:    #9aa0a8
--a-text-3:    #5e6470
--a-accent:    #d4a056   /* amber */
--a-good:      #6bb39a
--a-warn:      #d4a056
--a-bad:       #c46a6a
--a-info:      #7fa9d6
```

### Direction B — Calm (light default)
```
--b-bg:        #f7f5f0
--b-surface:   #ffffff
--b-surface-2: #faf8f3
--b-border:    #e6e1d6
--b-border-2:  #d4cfc1
--b-text:      #1d1f1a
--b-text-2:    #5c5e58
--b-text-3:    #8a8b84
--b-accent:    #5d7c5d   /* sage */
--b-good:      #5d7c5d
--b-warn:      #b88746
--b-bad:       #a8554d
--b-info:      #5a7a96
```

Both directions invert cleanly to dark/light variants — see `design_reference/theme.css` for full token table including dark Calm and light Operator.

### Habitat tier colors (shared across directions)
```
--tier-individual: #6BB39A
--tier-team:       #7FA9D6
--tier-org:        #C7A86B
--tier-orgpublic:  #D58A5A
--tier-public:     #C46A6A
```

### Risk levels (shared)
```
--risk-1: #6BB39A   /* same as individual */
--risk-2: #7FA9D6
--risk-3: #C7A86B
--risk-4: #D58A5A
--risk-5: #C46A6A
```

### Spacing & radius
- Base unit: `4px`
- Card radius: Calm `12px`, Operator `4px`
- Button radius: Calm `8px`, Operator `3px`
- Pill radius: `999px` (Calm), `3px` (Operator)

### Shadows
Calm cards use `0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px var(--b-border)` (or your equivalent). Operator is borders-only, no shadows — keeps the terminal-utility feel.

---

## Backend assumptions

Out of scope for the GUI handoff, but the API the GUI calls should support:

- `GET /api/harnesses` → list, `GET /api/harnesses/:id` → detail
- `POST /api/harnesses/:id/restart` body `{ mode: 'quick' | 'rebuild' | 'purge' }`
- `POST /api/harnesses/restart-running` → bulk quick-restart everything in `running` status
- `GET/POST /api/surfaces` (integrations)
- `GET/POST /api/keys`, `POST /api/keys/:id/rotate`
- `GET/POST /api/tools`, `POST /api/tools/:id/review` (mark reviewed + set allowedTiers)
- `GET/POST /api/memory-scopes`
- `GET /api/people` (v1: just admin + community list from chat surfaces)
- `GET /api/audit`
- `GET /api/models`, `POST /api/models/:id/access-tier` body `{ tier: 'open' | 'admin' }`
- `GET /api/settings`, `POST /api/settings/local-api` body `{ enabled: bool }`

The cache-state pill is computed by Hermes — likely `GET /api/harnesses/:id/runtime-state` returning `{ cacheState: 'warm' | 'rebuild-needed' | 'rebuilding', cacheAge: number, reason?: string }`.

Stream updates via SSE or websocket from `/api/events` (status changes, log lines for the activity card). For v1 polling every 5s is acceptable.

---

## Files in this handoff

- `CLAUDE_CODE_PROMPT.md` — paste this to Claude Code as the starting instructions
- `README.md` — this file
- `design_reference/Swarm Map Redesign.html` — open this in a browser to see the live prototype
- `design_reference/DESIGN_NOTES.md` — conceptual model, principles, roadmap
- `design_reference/mock-data.js` — full sample data shape (single source of truth for the data model)
- `design_reference/theme.css` — full token table for both directions × both themes
- `design_reference/*.jsx` — direction A (operator) and B (calm) component source for reference. Read; don't copy.

---

## Open questions for the human / product lead

These are intentionally undecided — surface them when you hit them:

1. **Per-harness invocation rules UI** — does "who can invoke" live on the harness page or the surface page? Both feel natural. A/B with real users post-launch; pick what hurts less.
2. **MCP tool import flow** — out of v1 scope to design, but the data model assumes MCP-imported tools land in the registry with `reviewed: false`. Importing UI is a v2 problem.
3. **Cross-surface identity** — v1 punts on linking @juni-on-Mattermost to @juni-on-Telegram. v2 problem. Until then, the same person appears twice in the community list if they message from both.
