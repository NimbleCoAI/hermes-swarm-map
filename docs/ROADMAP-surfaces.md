# Surfaces & Permissions Roadmap

## Done

- [x] **Signal-cli daemon setup** — shared multi-account daemon, raw signal-cli (not bbernhard)
- [x] **Registration flow** — `scripts/signal-register.sh` + API routes (`/api/surfaces/signal/register`, `/verify`)
- [x] **Connect dialogs** — Signal (multi-step wizard), Telegram (token form), Mattermost (URL+token form)
- [x] **Surface detection** — `config.ts` detects `SIGNAL_ACCOUNT`, `TELEGRAM_BOT_TOKEN`, `MATTERMOST_URL` from agent `.env`
- [x] **Connect API** — `POST /api/harnesses/[id]/surfaces/connect` writes env vars to `.env`
- [x] **Signal in setup wizard** — phone number field, writes SIGNAL_* env vars on deploy
- [x] **Health endpoint** — `GET /api/surfaces/signal` (daemon health + account list)
- [x] **Removed top-level surfaces page** — managed per-harness now

## P0 — Required for v1

- [ ] **Settings tab per harness** — new tab showing per-surface access control
  - Per-surface approved users (tag input, comma-separated → env var)
  - Per-surface approved groups/channels (tag input → env var)
  - DM policy toggle: approved-only vs allow-all
  - Read from both `.env` (static) and pairing store JSON (dynamic approvals)
  - `GET/PUT /api/harnesses/[id]/settings`

- [ ] **Admin users per surface** — display who has admin privileges
  - Mattermost: `MATTERMOST_ADMIN_USERS` env var
  - Signal/Telegram: show "not enforced" until Hermes adds support

- [ ] **Register Signal on Mac Mini** — need to re-register +19498344611 (or new number) from the Mac Mini's daemon since accounts aren't transferable

- [ ] **Restart prompt after settings change** — when env vars are modified, prompt "Restart agent to apply changes?"

## P1 — Important, next sprint

- [ ] **UUID resolution** — resolve @handles / phone numbers to platform-specific UUIDs
  - Signal: phone → UUID via signal-cli `getUserStatus`
  - Telegram: username → user ID via Bot API `getChat`
  - Mattermost: username → user ID via `/api/v4/users/username/{name}`
  - Display both (human-readable + UUID) in the admin UI

- [ ] **Pairing store visibility** — read `~/.hermes-{name}/pairing/{platform}-approved.json`, show dynamically-approved users alongside static allowlist, allow revoking

- [ ] **Connected surface config editing** — edit existing surface config (change token, URL) without disconnecting/reconnecting

- [ ] **Disconnect surface** — remove env vars, move surface back to "Available"

- [ ] **Tier-based defaults** — when tier is `public`/`orgpublic`, default DM policy to "allow-all"; when `individual`, default to approved-only. Suggested, not enforced.

## P2 — Important but complex

- [ ] **Tier-based tool permissions** — sane defaults per habitat level
  - `individual`: all tools available (user trusts themselves)
  - `team`: restrict dangerous tools (file system, shell, credentials)
  - `org`: further restrict to curated safe set
  - `orgpublic`/`public`: minimal tool set, read-only where possible
  - Defaults auto-applied on tier assignment, admin can override per-harness
  - UI: tool list with tier badges + toggle to break from defaults
  - Enforcement: swarm-map writes allowed tool list to agent config; Hermes respects it

- [ ] **Tier default override UI** — "This harness uses custom tool permissions (differs from team defaults)" with diff view showing what's added/removed vs the tier baseline

## P3 — Backlog

- [ ] **Group/channel discovery** — list available groups from the platform
  - Signal: `listGroups` RPC
  - Mattermost: `/api/v4/channels` 
  - Telegram: not possible via Bot API (bots can't list groups they're not in)

- [ ] **Cross-scope memory control** — "Can non-admins query memory from other conversations?" 
  - Requires Hermes code changes (session.py scoping is automatic, no toggle exists)
  - Would need a new env var like `MEMORY_CROSS_SCOPE=true/false`

- [ ] **Bulk user management** — import/export approved user lists (CSV, JSON)

- [ ] **Audit log for permission changes** — track who changed what, when

- [ ] **Real-time pairing sync** — watch pairing store files for changes, update UI without refresh

- [ ] **Signal @mentions in admin** — when adding approved users, auto-resolve Signal UUIDs and show contact names

## Architecture Decisions

1. **No permission matrix.** Old Swarm-Map had groups × tiers × tools. Over-engineered. We use flat per-surface allowlists managed via env vars.

2. **Hermes enforces, swarm-map configures.** No enforcement logic in swarm-map. It writes env vars; Hermes reads them.

3. **Tiers are labels.** They inform human decisions (what tier is this agent?) but don't bind permissions programmatically. Could change later.

4. **Memory stays global + per-harness.** Global view useful for cross-cutting visibility. Per-harness tab already filters.

5. **Two sources of approved users.** Static (`.env`) and dynamic (pairing store). Admin UI shows both, writes to `.env` for static, reads pairing JSON for dynamic.
