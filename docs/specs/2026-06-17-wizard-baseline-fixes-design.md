# Create-New Wizard — Baseline Fixes (Phase 1)

**Date:** 2026-06-17
**Author:** Juniper Bevensee
**Branch:** `dev/juniperbevensee/wizard-baseline-fixes` (off `main`)
**Driver:** Get Matilde (science bot) born well; fix the gaps spotted while walking the create-new wizard.

This spec covers **Phase 1** only. Phase 2 (package opt-in / public use-case templates / Matilde
overlay) is sketched at the end and gets its own spec.

---

## Background (current behavior)

The create-new wizard (`app/(setup)/setup/wizard/page.tsx`) is a 5-step flow:
Identity → Model → Platforms → Keys → Deploy. Findings from investigation:

- **Keys** step is free-text only. It has zero integration with the existing key registry
  (`lib/services/keys.ts`, `GET /api/keys`) which already discovers/stores keys from other agents.
  The registry returns only `maskedValue`; raw values are reachable internally via
  `services.keys.getDecryptedValue(id)`.
- **Model** step lists ollama as a provider, and deploy already writes
  `OLLAMA_BASE_URL=http://host.docker.internal:11434/v1`. So host-GPU ollama already works — it's
  just not surfaced as a distinct, validated choice, and there is no in-container option.
- **Platforms** step only sets boolean flags + collects credentials written to `.env` at deploy.
  It runs no real registration. Meanwhile the **Surfaces** tab
  (`components/surfaces/*-setup-dialog.tsx`) has a full, working register flow (Signal
  captcha→verify→profile, Telegram getMe, Mattermost verify). The flow is duplicated/absent in the
  wizard. Server endpoints (`/api/surfaces/<p>/...`) and the shared
  `/api/harnesses/{id}/surfaces/connect` + `lib/env-helpers.ts` are already reusable; the *client*
  state machine is tightly coupled to the harness detail page.

---

## Phase 1 scope

### 1A — Assign an existing key

**Goal:** Pick an already-configured key from the registry instead of pasting one.

- **Keys step UI:** per required-provider, a toggle **Use existing** ↔ **Enter new**.
  - *Use existing:* dropdown from `GET /api/keys` filtered to the selected provider, showing
    `name · maskedValue · health`. Selecting stores `existingKeyId` in wizard state (never a value).
  - *Enter new:* unchanged free-text, plus an optional **"Save to registry for reuse"** checkbox.
- **Deploy route (`app/api/setup/deploy/route.ts`):** when `existingKeyId` is present, resolve the
  real value server-side via `services.keys.getDecryptedValue(existingKeyId)` and write it into the
  new agent's `.env`; append the new harness id to that key's `assignedTo`. If "save to registry"
  was set on a new key, create the registry entry. The browser never receives a secret.
- **Validation:** Keys step passes when the required provider has either a non-empty new value or a
  selected `existingKeyId`. Ollama still needs no key.

**Tests:** deploy writes the resolved value when `existingKeyId` given; `assignedTo` updated;
no raw value crosses the API boundary; missing/invalid `existingKeyId` errors cleanly.

### 1B — Ollama, two explicit modes

**Goal:** Make "host GPU" vs "bundled tiny CPU" a clear choice; ship a zero-setup aha.

- **Model step UI:** when ollama is chosen (primary or fallback), a radio:
  - **Host GPU** *(default)* — uses `host.docker.internal:11434`. Add a "check host ollama"
    reachability ping (calls a small server route that probes the host endpoint).
  - **Bundled tiny (CPU)** — adds an `ollama-{slug}` sidecar to the generated compose; auto-pulls
    **`qwen2.5:0.5b`** on boot; hermes points at the sidecar and `depends_on` its health.
- **Compose generation (`lib/services/harness-compose.ts`):** add an optional ollama sidecar mirroring
  the camofox sidecar (image `ollama/ollama`, named volume for model cache, init that pulls the
  model then serves, healthcheck on `:11434`). CPU by default (GPU is the host path). Gate behind a
  `bundledOllama` flag from the wizard.
- **Deploy route:** when bundled mode, point `OLLAMA_BASE_URL` at the sidecar
  (`http://ollama-{slug}:11434/v1`) instead of `host.docker.internal`.

**Tests:** compose includes the ollama service + volume + healthcheck only when bundled; host mode
emits `host.docker.internal`; bundled mode emits the sidecar URL; default model is `qwen2.5:0.5b`.

### 1C — Surfaces register integration (DRY)

**Goal:** Wizard platforms run the *real* register flow, sharing one codepath with the Surfaces tab.

- **Extract** the register state machine from the surfaces dialogs into:
  - a `useSurfaceRegister` hook (owns step machine + API calls), and
  - a `<SurfaceConnectDialog platform target={harnessId | 'pending'}>` component.
- **Surfaces tab:** refactor to use the extracted component with `target={harnessId}` — behavior must
  stay byte-identical (pin existing behavior with tests first).
- **Wizard platforms step:** use the component with `target='pending'`. It runs the
  harness-independent steps (Signal register→captcha→verify→profile; Telegram getMe; Mattermost
  verify) and captures the resulting config into wizard state. The harness-binding `connect` call
  (needs a harness id) is **deferred to post-deploy**: after the harness is created, deploy/finish
  calls `POST /api/harnesses/{newId}/surfaces/connect` with the captured config.
- Server endpoints and `lib/env-helpers.ts` are reused unchanged.

**Tests:** extracted hook drives a full Signal happy path against mocked endpoints; `target='pending'`
captures config without calling connect; post-deploy connect is invoked with the captured config;
surfaces-tab regression test confirms unchanged behavior.

---

## Architecture notes

- Secrets never reach the browser — key resolution is server-side at deploy.
- Surfaces flow has exactly one client implementation after this; the wizard and Surfaces tab differ
  only in `target` and whether `connect` runs inline or post-deploy.
- Ollama host vs bundled differ only in the generated `OLLAMA_BASE_URL` and the presence of a sidecar.

## Risks

- **1C is the riskiest** (refactoring a working flow). Mitigation: pin surfaces-tab behavior with
  tests before extracting; keep the public dialog props stable.
- Bundled ollama image/model size and CPU first-token latency — `qwen2.5:0.5b` chosen for speed;
  clearly labeled optional.
- Deferred connect adds a post-deploy step that can fail after the harness exists — surface a clear
  "registered but not yet connected; retry from Surfaces" state rather than failing the whole deploy.

## Testing & execution

- Runner: `npx vitest run <path>` (no `test` script; vitest 4). Match existing
  `lib/services/__tests__/*.test.ts` patterns. RED→GREEN→refactor per unit.
- 1A / 1B / 1C touch mostly disjoint files → built in parallel, integrated at the deploy route /
  wizard page.

---

## Phase 2 (sketch — separate spec)

New **Package** step + `infra/usecase-templates.json` registry; extend `artifacts-manifest.ts` to
support `source: "git:<org>/<repo>#<ref>"` (note existing worktree
`dev/juniper/artifact-git-source-trust-gate` is doing adjacent trust-gate work — coordinate).
Template install contract: clone repo → run its `instance-setup.sh` if present, else copy per an
`overlay` map. First entry: **Matilde** (`NimbleCoAI/Matilde`), seeding `SOUL.Matilde.md`,
recommending anthropic + science setup.
