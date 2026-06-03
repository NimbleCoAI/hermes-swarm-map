# Design: Hermes Artifact Commons + HSM Manifest Loader

**Date:** 2026-06-03
**Author:** Juniper (with Claude)
**Status:** Design — pending implementation plan

## Problem & Driver

HSM today vendors all agent artifacts (plugins, skills, hooks) inline and installs
them by copying from a hardcoded list in `lib/services/templates.ts`. This couples
every artifact to the HSM repo and makes them un-shareable.

The goal: **artifacts (plugins, MCP servers, skills, tools) that work for anyone
running Hermes — not only inside HSM — so NimbleCo can publish general-commons
goods that funnel people into the ecosystem, while HSM remains a first-class
installer of both commons and multiplayer-specific artifacts.**

## Scope

**In scope:** artifact classification model; the sourcing/distribution model;
refactoring HSM's installer from hardcoded arrays to a manifest-driven loader.

**Explicitly out of scope (separate projects):**
- The `swarm-map` product rename (separate spec; do not conflate with artifact names).
- Actual PyPI/pip publishing (roadmap flag — see Phase 4).
- Cross-repo dedup of `swarm_map_policy` copies that live in *other* deployment
  repos (`hermes-agent`, `hermes-agent-swarm`, `hermes-swarm`). Per-repo hygiene, later.

## Core Model

Two orthogonal axes per artifact:

- **Type:** plugin · MCP server · skill · (tool = provided by a plugin)
- **Coupling:**
  - `vanilla` — works on plain/upstream Hermes; a commons candidate.
  - `multiplayer` / `hsm-specific` — depends on HSM/MT context (e.g. the `/policy`
    endpoint, HSM home channel, multiplayer OAuth); stays internal.

**Artifact = self-contained unit.** Contract-conformant: a directory plugin needs
`plugin.yaml` + `__init__.py` exposing `register(ctx)` (per the runtime loader
`hermes-agent-mt/hermes_cli/plugins.py`). A plugin ships **co-located with its
paired skill** (the `osint-engine/hermes-plugin/` + `hermes-skill/` pattern is the
reference). Tools live inside plugins; MCP servers are referenced, not copied.

**Repo unit = per-artifact** (or one repo for a tightly-paired plugin+skill).
Group only where already natural (osint-engine stays one repo). Rationale:
promotion to public = flipping *one* repo's visibility (instant, lossless), vs
moving directories between two monorepos (loses git history, breaks manifest pins).

**Visibility = per-repo, starts private.** A repo flips to public only when it
passes **both gates**:
1. **Mature** — proven in production (not just unit-tested).
2. **Clean** — generic + secret-free (no NimbleCo OAuth IDs, tokens, internal URLs).

Going public never means maintaining a parallel public copy of the whole system —
that reintroduces the duplication-drift problem at macro scale.

## HSM Installer — the Manifest Loader

Replace `TEMPLATE_PLUGINS/SKILLS/HOOKS` + `installBaselineTemplates`'s
`process.cwd()/infra/templates` copy with a manifest (`infra/artifacts.json`) the
loader resolves by `source`:

- `local:<path>` — current in-repo copy (HSM-specific artifacts).
- `upstream` — no-op; artifact already baked into the agent image.
- `git:<org>/<repo>#<tag>[:<subdir>]` — shallow clone at a **pinned tag**, copy the
  subdir into the agent dir. Pin tags (not branches) for reproducible installs.

MCP servers are modeled as **references** in the same manifest (a `mcp_servers`
config entry + optional mounted source / npx command), *not* copied — folding the
today-separate MCP wiring (`app/api/setup/deploy/route.ts`) into one declaration point.

**The loader must report what was actually installed and fail loudly.** This fixes
two current defects:
- `pluginsInstalled = [...TEMPLATE_PLUGINS]` (`harness.ts`) reports *intent*, not
  reality, and omits hooks/skills. Replace with actual-installed results.
- `installBaselineTemplates` silently `continue`s on a missing source dir
  (`existsSync` guard). A failed remote fetch would silently boot a
  capability-less agent. The new loader must surface failures, not swallow them.

## Initial Classification

| Artifact | Type | Coupling | Home |
|---|---|---|---|
| `captcha_cascade` + `captcha-escalation` | plugin+skill | vanilla | own repo — top commons pilot, *after* it is proven |
| `ocr-and-documents` | skill | vanilla | commons |
| `boot_md` | plugin | vanilla | upstream owns it; HSM copy is stale (see Phase 0) |
| `swarm_map_policy` | plugin | hsm-specific | stays `local:`, unchanged |
| `lifecycle-notify` | hook | hsm-specific | stays `local:` |
| `google-multiplayer-mcp` | MCP | multiplayer | private; needs secret-sanitization before any public consideration |
| github MCP | MCP | vanilla | manifest reference (standard npx server) |

## Migration Phases

Each phase is its own implementation plan + PR. **Phase 0 is a hard gate.**

### Phase 0 — Resolve the blocking unknown (verify on a live agent)
Research surfaced a contradiction: HSM assumes "copy == enabled" (it writes no
`plugins.enabled` block), but the runtime gates `standalone` plugins behind
`plugins.enabled` + `HERMES_ENABLE_PROJECT_PLUGINS`. **Determine, on a real
deployed agent, which is true** — i.e. do the currently-installed standalone
plugins actually load? This decides whether the manifest loader must *also* write
enable-flags. Nothing downstream starts until this is settled. (Also verify
whether the HSM `boot_md` copy loads at all — research indicates it lacks
`register()` and is therefore inert on the current runtime.)

### Phase 1 — Pure refactor (behavior-identical, safe by construction)
Introduce `infra/artifacts.json` listing **every current artifact as `local:`**.
Swap `installBaselineTemplates` to resolve the manifest. Fix install-reporting to
reflect reality. Update behavior-pinning tests.
- **Acceptance test = golden-output snapshot:** an agent dir generated by the old
  code and the new code must be **byte-identical**. If not, the refactor is wrong
  and does not ship.
- No artifact moves. Nothing is deleted. No runtime behavior changes.

### Phase 2 — Extract (HSM-only, one artifact at a time, prove-before-remove)
- De-scoped to HSM. **One artifact at a time, with real-agent verification between
  each.** Never big-bang.
- `boot_md`: only after Phase 0 confirms the HSM copy is inert, **stop installing
  the dead copy** (changes nothing observable) — not "delete and hope."
- `swarm_map_policy`: **unchanged** — stays `local:`. (Cross-repo copies are out of
  scope.)
- `captcha`: extract the plugin+skill to its own **private** repo; switch its
  manifest entry to `git:#tag`. This requires building the `git:` fetch:
  a **build-time token** (HSM server env, distinct from the agent's runtime
  `GITHUB_TOKEN`), a resolved-artifact cache, and loud failure on fetch error.
- Every step is a revertable PR.

### Phase 3 — Roadmap (out of build scope)
HSM installer/marketplace UX surfacing the registry; longer term, agents
discovering/installing their own capabilities from the registry via chat. North
star, not designed here.

### Phase 4 — Roadmap (out of build scope)
Per-artifact public visibility flips + pip/PyPI packaging, gated by maturity +
cleanliness, timed to the MT launch.

## Safety Rails (apply to all phases)
- **Prove-before-remove:** nothing is deleted until proven inert or output-identical.
- **One artifact at a time** in Phase 2, with live-agent verification between each.
- **Every step a revertable PR.**
- **Loud failure:** the loader refuses to silently boot a capability-less agent.
- **Phase 0 hard gate** before any extraction.

## Top Risks (carried into the plan)
1. `copy == enable` contradiction — **Phase 0 gate**.
2. Silent partial-fetch failure booting capability-less agents → loader verifies + reports.
3. `swarm_map_policy ↔ /api/harnesses/:id/policy` is a runtime contract → keep the
   plugin internal; do not turn it into a cross-repo API boundary.
   (Note latent bug: `hsmPort` defaults differ — `3002` in `deploy/route.ts:127`
   vs `3000` in `harness.ts:1035`.)
4. MCP is a *different* mechanism (config + mount/npx, not a copy) → manifest models
   it as a reference; `google-multiplayer-mcp` stays multiplayer-specific/private.
5. No git-fetch/auth exists today → build it carefully with build-time creds.

## Testing
- TDD the loader against `artifacts.json` fixtures: each `source` type
  (`local`/`upstream`/`git`), missing-artifact failure path, install-report accuracy.
- Phase 1 golden-output snapshot (old vs new install = byte-identical).
- Update behavior-pinning tests: `lib/templates/config-yaml.test.ts` (MCP arg
  strings), `lib/services/__tests__/tools-discovery.test.ts` /
  `tools-auto-populate.test.ts` (skill-dir-derived tool IDs).
- Phase 0 and Phase 2 each include real-deployed-agent verification, not only units.

## Key Files (current touchpoints)
- `lib/services/templates.ts` — hardcoded arrays + `installBaselineTemplates` (the loader to replace).
- `lib/services/harness.ts` — install call sites (~235, ~1077) + `pluginsInstalled` reporting.
- `app/api/setup/deploy/route.ts` — deploy-flow install + MCP wiring + `GITHUB_TOKEN`.
- `lib/templates/config-yaml.ts` — `mcp_servers` block generation.
- `lib/services/tools.ts` — skill-dir-derived tool discovery.
- `app/api/harnesses/[id]/policy/route.ts` — the `swarm_map_policy` runtime contract.
- Reference: `osint-engine/hermes-plugin/` + `hermes-skill/` (contract-conformant co-location).
- Runtime loader: `hermes-agent-mt/hermes_cli/plugins.py`.
