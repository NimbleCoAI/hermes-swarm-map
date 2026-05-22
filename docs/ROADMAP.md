# Hermes Swarm Map — Roadmap

HSM is the management plane for multi-tenant Hermes. It configures, deploys, monitors, and controls agent harnesses. This roadmap works backward from what V1 must ship, then forward to V2.

---

## V1: Secure Multi-Tenant Agent Management

**Ship when:** Any team member can create an agent through the wizard and it comes up secure-by-default. Settings persist through restarts. Admin identity is unified.

### Done

- [x] Per-harness settings tab (DM policy, group invite, mention-gating, command approval)
- [x] Per-surface admin management (Surfaces tab, unified identity: approved = admin)
- [x] Memory scope toggle (channel/global per harness, `HERMES_MEMORY_SCOPE` env var)
- [x] Settings API (GET/PUT `/api/harnesses/[id]/settings`)
- [x] Auto-restart with rebuild on settings save (both Settings tab and Surfaces)
- [x] Signal/Telegram/Mattermost surface connect/disconnect flows
- [x] Discover existing groups (Signal, Mattermost)
- [x] Pairing store visibility + revocation
- [x] Model cascade with fallback providers (`config.yaml` fallback_providers)
- [x] Standalone compose per harness (generated, managed by HSM)
- [x] 5-step create wizard (Identity → Model → Surfaces → Keys → Deploy)
- [x] Container monitoring (CPU, memory, health, last seen)
- [x] Policy enforcement via swarm_map_policy plugin

### Must Ship

- [ ] **Wizard sane-config enforcement** — deploy step must set: `HERMES_MEMORY_SCOPE=channel`, `HSM_URL`, `HERMES_AGENT_NAME`, container hardening (cap_drop, no-new-privileges), auto-install swarm_map_policy plugin
- [ ] **Settings round-trip integrity** — all toggles must survive GET→UI→PUT→rebuild without silent data loss. Wildcard `*` preservation is fixed for users/groups. Audit all env vars for similar patterns.
- [ ] **Async restart** — Docker builds run background, API returns immediately, UI polls for completion. No more spawnSync timeouts.
- [ ] **UUID resolution in admin UI** — resolve phone numbers / @handles to platform-native UUIDs. Display both in admin list. (Signal: `getUserStatus`, Telegram: `getChat`, Mattermost: `/api/v4/users/username`)
- [ ] **Cascade derives from connected providers** — model cascade should read available models from connected API keys/providers, not hardcode model IDs. Cascade just sets priority order. Stale model names = broken agents.
- [ ] **Model name discovery** — helper to list valid model IDs per provider on demand. Prevents stale cascade entries.
- [ ] **Tier-based defaults** — when tier is `public`/`orgpublic`, default DM policy to allow-all; when `individual`, default to approved-only. Suggested, not enforced.
- [ ] **Configurable default image** — wizard pulls from GHCR (`ghcr.io/nimblecoorg/hermes-agent:latest`) or configurable registry. Setting in HSM config.

### Should Ship

- [ ] **Tier-based tool permissions** — sane defaults per tier (individual=all, team=restricted, org=curated, public=minimal). Admin can override per-harness. Diff view showing deviations from tier baseline.
- [ ] **Admin search hook** — memory reads default to channel scope, require explicit `--global` for cross-channel search. Backend done (context_id scoping), needs UI toggle + gateway read-path enforcement.
- [ ] **Cross-scope memory control** — toggle: "Can non-admins query memory from other conversations?" Admin gets prompt, non-admin gets blocked. Needs Hermes code changes.
- [ ] **Audit log for permission changes** — track who changed what, when. HSM already has audit service scaffolding.
- [ ] **Bulk user management** — import/export admin lists (CSV, JSON).
- [ ] **Auto-approve on admin invite** — when admin adds bot to group, auto-add to allowed groups. Telegram/Mattermost only (Signal lacks group-join events).

---

## V2: Operational Intelligence

**Ship when:** HSM is not just config management but gives operators insight into what agents are doing, how they're performing, and where they need attention.

### Planned

- [ ] **Cost tracking** — per-harness, per-model token usage and cost. LiteLLM integration or direct provider API parsing. Daily/weekly/monthly views.
- [ ] **Conversation analytics** — message volume, response times, tool usage patterns per harness.
- [ ] **Agent health dashboard** — beyond container metrics. Track: cascade fallback frequency, error rates, memory usage growth, skill invocation patterns.
- [ ] **Multi-harness operations** — bulk restart, bulk settings update, fleet-wide model rotation.
- [ ] **Alerting** — configurable alerts for: cascade fully exhausted, memory approaching limits, unusual error spikes, container restarts.
- [ ] **Session key isolation** — per-user session keys in multi-tenant groups. Core fork patch for multi-tenancy (alongside memory scoping).
- [ ] **Plugin marketplace** — browse/install plugins from HSM UI. Currently manual (`$HERMES_HOME/plugins/`).
- [ ] **Upstream RFC: memory:scope hook** — propose to NousResearch so plugins can control memory scoping without patching core. If accepted, fork carries zero core patches.

---

## Dependencies on Hermes Fork (hermes-agent-mt)

HSM configures; Hermes enforces. These items need fork/upstream changes before HSM can expose them:

| HSM Feature | Hermes Dependency | Status |
|-------------|-------------------|--------|
| Memory scope toggle | `HERMES_MEMORY_SCOPE` env var in gateway | Done |
| Admin identity | `is_platform_admin()` via swarm_map_policy | Done |
| Admin search hook | Read-path channel scoping in memory tool | Todo |
| Cross-scope memory | `MEMORY_CROSS_SCOPE_ADMIN` env var | Todo |
| Session key isolation | Per-user session keys in gateway | Todo |
| Tool permissions | Hermes respects allowed tool list from config | Todo |

---

## Architecture Principles

1. **HSM configures, Hermes enforces.** No enforcement logic in HSM. It writes env vars and config; Hermes reads them.
2. **No permission matrix.** Flat per-surface admin lists managed via env vars. No groups × tiers × tools cross-product.
3. **Tiers are labels.** They inform defaults but don't bind permissions programmatically.
4. **Wizard produces secure agents.** Every agent created through HSM gets baseline security without manual config.
5. **Settings survive restarts.** Every toggle must round-trip through GET→UI→PUT→rebuild without data loss.
6. **Two sources of approved users.** Static (`.env`) and dynamic (pairing store). Admin UI shows both.
