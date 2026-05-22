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

- [ ] **Capability gating & binding** — the final settings dimension. Completes the security model alongside admin identity, memory scoping, and command approval. See [Capability Gating](#capability-gating) below.
- [ ] **Admin search hook** — memory reads default to channel scope, require explicit `--global` for cross-channel search. Backend done (context_id scoping), needs UI toggle + gateway read-path enforcement.
- [ ] **Cross-scope memory control** — toggle: "Can non-admins query memory from other conversations?" Admin gets prompt, non-admin gets blocked. Needs Hermes code changes.
- [ ] **Audit log for permission changes** — track who changed what, when. HSM already has audit service scaffolding.
- [ ] **Bulk user management** — import/export admin lists (CSV, JSON).
- [ ] **Auto-approve on admin invite** — when admin adds bot to group, auto-add to allowed groups. Telegram/Mattermost only (Signal lacks group-join events).

---

### Capability Gating

This is the big one — controls what each agent can do and who can trigger what. It's a "should ship V1, could slip to V2" item because the concept is right but the implementation touches multiple systems.

**Core idea:** Every capability (tool, skill, plugin, env key) has a risk level. Habitat tiers set defaults. Admins customize per-harness. Non-admins get a restricted subset.

#### 1. Risk Classification

Every capability gets a risk level:

| Risk | Examples | Default |
|------|----------|---------|
| **safe** | web search, calculator, memory read | Everyone |
| **moderate** | file read, code execution (sandboxed), API calls | Admin in public tiers, everyone in team/individual |
| **dangerous** | shell access, file write, credential access, self-improvement | Admin only, all tiers |
| **critical** | propose_improvement, raw system commands, env modification | Admin + explicit approval |

Risk levels are properties of the capabilities themselves, not per-harness config. HSM maintains a registry.

#### 2. Tier Defaults

Each habitat tier gets a default capability profile:

| Tier | safe | moderate | dangerous | critical |
|------|------|----------|-----------|----------|
| `individual` | all | all | all | admin |
| `team` | all | all | admin | admin+approval |
| `org` | all | admin | admin | disabled |
| `orgpublic` | all | restricted | disabled | disabled |
| `public` | curated | disabled | disabled | disabled |

These are **defaults** — the starting point when an agent is created at a given tier. Not enforced ceilings.

#### 3. Per-Harness Override

Settings tab gets a "Capabilities" section where admins can:
- See current capability profile (inherited from tier)
- Toggle individual capabilities on/off
- See diff from tier baseline ("3 capabilities added, 1 removed vs team defaults")
- Set admin-only vs everyone for each capability

#### 4. Admin vs Non-Admin Gating

Two-level access per capability:
- **Available to everyone** — any user in an approved group can trigger it
- **Admin only** — only admins can trigger it

This is the tool-level equivalent of the command approval toggle. Non-admins trying to use an admin-gated tool get a clear rejection ("This tool requires admin access").

#### 5. Capability Binding (Import/Share)

Capabilities aren't just built-in — they can be bound to harnesses from external sources:

- **Tools** — from Hermes upstream, custom plugins, MCP servers
- **Skills** — from skill directories, shared across harnesses
- **Plugins** — installed per-harness or shared
- **Env keys** — API keys, service credentials bound to specific harnesses
- **MCP servers** — external tool providers connected per-harness

HSM needs a "capability library" where capabilities are registered once, then bound to harnesses. When someone adds a new MCP server or API key, they import it to HSM, then assign it to the harnesses that should have it. This prevents credential sprawl and makes it clear which agents have access to what.

#### 6. Hermes Enforcement

HSM writes the allowed capability list to the agent's config. Hermes reads it and enforces:
- Tool calls checked against the allowed list before execution
- Admin-only tools check `source.is_admin` before proceeding
- Unrecognized tools rejected (whitelist, not blacklist)

**Hermes dependency:** Needs a `HERMES_ALLOWED_TOOLS` or `tools.allowed` config that the gateway reads and enforces. Currently Hermes has `enabled_toolsets` but it's coarser-grained than per-tool control.

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
| Capability gating | Per-tool allow/deny + admin-only enforcement in gateway | Todo |
| Capability binding | Config format for bound tools/skills/plugins/env keys | Todo |

---

## Architecture Principles

1. **HSM configures, Hermes enforces.** No enforcement logic in HSM. It writes env vars and config; Hermes reads them.
2. **No permission matrix.** Flat per-surface admin lists managed via env vars. No groups × tiers × tools cross-product.
3. **Tiers are labels.** They inform defaults but don't bind permissions programmatically.
4. **Wizard produces secure agents.** Every agent created through HSM gets baseline security without manual config.
5. **Settings survive restarts.** Every toggle must round-trip through GET→UI→PUT→rebuild without data loss.
6. **Two sources of approved users.** Static (`.env`) and dynamic (pairing store). Admin UI shows both.
