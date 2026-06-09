# Artifact Manifest Loader (Phase 0 + Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HSM's hardcoded `TEMPLATE_*` artifact arrays with a manifest-driven loader (`infra/artifacts.json`) that produces a byte-identical agent directory, reports what it actually installed, and fails loudly — after first verifying on a live agent how installed plugins actually load.

**Architecture:** A new focused module `lib/services/artifacts-manifest.ts` reads `infra/artifacts.json` and resolves each entry's `source` (Phase 1: only `local` — copy from `infra/templates/<type>/<name>`). `installBaselineTemplates` delegates to it and returns structured `InstallResult[]`. A small `hsm-url.ts` helper unifies the `hsmPort` default. No artifacts move, nothing is deleted, runtime behavior is unchanged (proven by a golden-output test).

**Tech Stack:** TypeScript, Next.js, Node `fs`/`fs/promises`, Vitest.

**Spec:** `docs/specs/2026-06-03-artifact-commons-design.md`

---

## File Structure

- Create: `lib/services/artifacts-manifest.ts` — manifest types, `loadManifest()`, `installArtifacts()`.
- Create: `lib/services/hsm-url.ts` — `hsmPort()` / `hsmBaseUrl()` shared helper.
- Create: `infra/artifacts.json` — the manifest (all `local` in Phase 1).
- Create: `lib/services/__tests__/artifacts-manifest.test.ts` — loader unit + golden-output tests.
- Create: `lib/services/__tests__/hsm-url.test.ts` — helper unit tests.
- Modify: `lib/services/templates.ts` — `installBaselineTemplates` delegates to the manifest loader, returns `InstallResult[]`.
- Modify: `lib/services/harness.ts` — `pluginsInstalled` uses actual install results; import `hsmPort` from the helper.
- Modify: `app/api/setup/deploy/route.ts` — use `hsmBaseUrl()` instead of the inline `process.env.PORT || '3002'`.

---

## Task 0: Phase 0 — Verify plugin loading on a live agent (HARD GATE)

This is a verification task, not code. **Do not start Task 1+ until this is resolved**, because it determines whether the loader must also write enable-flags.

**The question:** HSM copies plugins into the agent dir but writes no `plugins.enabled` block. The runtime (`hermes-agent-mt/hermes_cli/plugins.py`) gates `standalone` plugins behind `plugins.enabled` + `HERMES_ENABLE_PROJECT_PLUGINS`. Do the currently-installed standalone plugins (`captcha_cascade`) actually load in a real deployed agent?

- [ ] **Step 1: Inspect a running agent's loaded plugins.**

Pick a deployed agent and check what the runtime actually loaded. Via the HSM API or by inspecting the container logs at startup for the plugin-load summary (the loader logs discovered/loaded plugins). Confirm whether `captcha_cascade` (a `standalone` plugin) appears as loaded.
Run (example): `docker logs hermes-<agent> 2>&1 | grep -i "plugin"`
Expected: a log line listing loaded plugins, OR an indication standalone plugins were skipped.

- [ ] **Step 2: Check the agent's `config.yaml` and env for the gating flags.**

Inspect the deployed agent's `config.yaml` for a `plugins:` / `plugins.enabled` block and its `.env`/compose for `HERMES_ENABLE_PROJECT_PLUGINS`.
Run (example): `cat ~/.hermes-<agent>/config.yaml; grep -i ENABLE_PROJECT ~/.hermes-<agent>/.env`
Expected: determines whether the gating flags are present.

- [ ] **Step 3: Record the verdict and branch the plan.**

Write the finding into the spec (`docs/specs/2026-06-03-artifact-commons-design.md`, Phase 0 section):
- **Verdict A — copy == enabled (no flag needed):** the loader only needs to copy dirs. Proceed to Task 1 as written.
- **Verdict B — enablement required:** the loader must ALSO write `plugins.enabled` (and/or set `HERMES_ENABLE_PROJECT_PLUGINS`). Add a follow-up note to Task 5 to write the enable-list from the manifest. Proceed, with that addition.
Also record whether the HSM `boot_md` copy loads (research indicates it lacks `register()` and is inert).

- [ ] **Step 4: Commit the verdict.**

```bash
git add docs/specs/2026-06-03-artifact-commons-design.md
git commit -m "docs: Phase 0 verdict — how installed plugins load on a live agent"
```

---

## Task 1: `hsm-url.ts` shared helper (the drive-by fix)

**Files:**
- Create: `lib/services/hsm-url.ts`
- Test: `lib/services/__tests__/hsm-url.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/services/__tests__/hsm-url.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { hsmPort, hsmBaseUrl } from '../hsm-url'

describe('hsm-url', () => {
  const original = process.env.PORT
  afterEach(() => {
    if (original === undefined) delete process.env.PORT
    else process.env.PORT = original
  })

  it('defaults hsmPort to 3000 when PORT is unset', () => {
    delete process.env.PORT
    expect(hsmPort()).toBe('3000')
  })

  it('uses process.env.PORT when set', () => {
    process.env.PORT = '4242'
    expect(hsmPort()).toBe('4242')
  })

  it('builds the host.docker.internal callback URL', () => {
    delete process.env.PORT
    expect(hsmBaseUrl()).toBe('http://host.docker.internal:3000')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/services/__tests__/hsm-url.test.ts`
Expected: FAIL — cannot resolve `../hsm-url`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/services/hsm-url.ts
// HSM's own callback port — the port the HSM server listens on, used to build the
// HSM_URL / SWARM_MAP_POLICY_URL that agents call back into. Distinct from the
// per-agent API_SERVER_PORT (which is dynamically allocated). HSM runs on 3000
// (see ecosystem.config.js); default to 3000 so the two install paths can't drift.
export function hsmPort(): string {
  return process.env.PORT || '3000'
}

export function hsmBaseUrl(): string {
  return `http://host.docker.internal:${hsmPort()}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/services/__tests__/hsm-url.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/hsm-url.ts lib/services/__tests__/hsm-url.test.ts
git commit -m "feat: hsm-url helper unifying the HSM callback port default to 3000"
```

---

## Task 2: Apply `hsm-url` to the two drifting call sites

**Files:**
- Modify: `app/api/setup/deploy/route.ts` (the `process.env.PORT || '3002'` site, ~line 127)
- Modify: `lib/services/harness.ts` (the `process.env.PORT || '3000'` site, ~line 1035)

- [ ] **Step 1: Replace the deploy-route inline default**

In `app/api/setup/deploy/route.ts`, add the import at the top with the other `@/lib/services` imports:

```typescript
import { hsmBaseUrl } from '@/lib/services/hsm-url'
```

Replace:

```typescript
  const hsmPort = process.env.PORT || '3002'
  ...
  lines.push(`HSM_URL=http://host.docker.internal:${hsmPort}`)
  lines.push(`SWARM_MAP_POLICY_URL=http://host.docker.internal:${hsmPort}`)
```

with:

```typescript
  const hsmUrl = hsmBaseUrl()
  ...
  lines.push(`HSM_URL=${hsmUrl}`)
  lines.push(`SWARM_MAP_POLICY_URL=${hsmUrl}`)
```

- [ ] **Step 2: Replace the harness.ts inline default**

In `lib/services/harness.ts`, add to the existing imports:

```typescript
import { hsmBaseUrl } from './hsm-url'
```

Replace:

```typescript
    const hsmPort = process.env.PORT || '3000'
    const requiredVars: Record<string, string> = {
      HSM_URL: `http://host.docker.internal:${hsmPort}`,
      SWARM_MAP_POLICY_URL: `http://host.docker.internal:${hsmPort}`,
```

with:

```typescript
    const hsmUrl = hsmBaseUrl()
    const requiredVars: Record<string, string> = {
      HSM_URL: hsmUrl,
      SWARM_MAP_POLICY_URL: hsmUrl,
```

- [ ] **Step 3: Run the affected suites to verify no regression**

Run: `npx vitest run lib/services/__tests__/harness-e2e.test.ts lib/templates/config-yaml.test.ts`
Expected: PASS. (The e2e test asserts `HSM_URL`/`SWARM_MAP_POLICY_URL` are present in `.env` — they still are, now consistently `:3000`.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "signal-pin.test.ts"`
Expected: no new errors (a pre-existing `signal-pin.test.ts` error is unrelated).

- [ ] **Step 5: Commit**

```bash
git add app/api/setup/deploy/route.ts lib/services/harness.ts
git commit -m "fix: unify HSM callback port default to 3000 via hsm-url helper"
```

---

## Task 3: Manifest types + `loadManifest()`

**Files:**
- Create: `lib/services/artifacts-manifest.ts`
- Test: `lib/services/__tests__/artifacts-manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/services/__tests__/artifacts-manifest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadManifest } from '../artifacts-manifest'

let tmp: string
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-manifest-')) })
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

describe('loadManifest', () => {
  it('parses a manifest with plugins, skills, and hooks', () => {
    const manifestPath = path.join(tmp, 'artifacts.json')
    fs.writeFileSync(manifestPath, JSON.stringify({
      plugins: [{ name: 'swarm_map_policy', source: 'local' }],
      skills: [{ name: 'ocr-and-documents', source: 'local' }],
      hooks: [{ name: 'lifecycle-notify', source: 'local' }],
    }))
    const m = loadManifest(manifestPath)
    expect(m.plugins).toEqual([{ name: 'swarm_map_policy', source: 'local' }])
    expect(m.skills[0].name).toBe('ocr-and-documents')
    expect(m.hooks[0].name).toBe('lifecycle-notify')
  })

  it('defaults missing sections to empty arrays', () => {
    const manifestPath = path.join(tmp, 'artifacts.json')
    fs.writeFileSync(manifestPath, JSON.stringify({ plugins: [] }))
    const m = loadManifest(manifestPath)
    expect(m.plugins).toEqual([])
    expect(m.skills).toEqual([])
    expect(m.hooks).toEqual([])
  })

  it('throws a clear error when the manifest file is missing', () => {
    expect(() => loadManifest(path.join(tmp, 'nope.json')))
      .toThrow(/artifacts manifest not found/i)
  })

  it('throws a clear error on invalid JSON', () => {
    const manifestPath = path.join(tmp, 'artifacts.json')
    fs.writeFileSync(manifestPath, '{ not json')
    expect(() => loadManifest(manifestPath)).toThrow(/invalid artifacts manifest/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/services/__tests__/artifacts-manifest.test.ts`
Expected: FAIL — cannot resolve `../artifacts-manifest`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// lib/services/artifacts-manifest.ts
import fs from 'fs'

export type ArtifactType = 'plugins' | 'skills' | 'hooks'

export interface ArtifactEntry {
  name: string
  // Phase 1: only 'local' is supported. Future: 'upstream', 'git:<org>/<repo>#<tag>'.
  source: string
}

export interface ArtifactsManifest {
  plugins: ArtifactEntry[]
  skills: ArtifactEntry[]
  hooks: ArtifactEntry[]
}

export function loadManifest(manifestPath: string): ArtifactsManifest {
  let raw: string
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8')
  } catch {
    throw new Error(`Artifacts manifest not found at ${manifestPath}`)
  }
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Invalid artifacts manifest at ${manifestPath}: ${(e as Error).message}`)
  }
  return {
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
    hooks: Array.isArray(parsed.hooks) ? parsed.hooks : [],
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/services/__tests__/artifacts-manifest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/services/artifacts-manifest.ts lib/services/__tests__/artifacts-manifest.test.ts
git commit -m "feat: artifacts manifest types + loadManifest"
```

---

## Task 4: `installArtifacts()` — resolve `local` sources, report results, fail loudly

**Files:**
- Modify: `lib/services/artifacts-manifest.ts`
- Modify: `lib/services/__tests__/artifacts-manifest.test.ts`

- [ ] **Step 1: Write the failing test (append to the test file)**

```typescript
// append to lib/services/__tests__/artifacts-manifest.test.ts
import { installArtifacts } from '../artifacts-manifest'

describe('installArtifacts (local source)', () => {
  function seedTemplates(root: string) {
    // Simulate infra/templates/<type>/<name>/<file>
    for (const [type, name] of [['plugins', 'p1'], ['skills', 's1'], ['hooks', 'h1']]) {
      const dir = path.join(root, 'infra', 'templates', type, name)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'file.txt'), `${name}-contents`)
    }
  }

  it('copies each local artifact into the agent dir and reports installed=true', async () => {
    const repoRoot = tmp
    seedTemplates(repoRoot)
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'))
    const manifest = {
      plugins: [{ name: 'p1', source: 'local' }],
      skills: [{ name: 's1', source: 'local' }],
      hooks: [{ name: 'h1', source: 'local' }],
    }
    const results = await installArtifacts(agentDir, manifest, repoRoot)
    expect(results).toContainEqual({ type: 'plugins', name: 'p1', installed: true })
    expect(fs.readFileSync(path.join(agentDir, 'plugins', 'p1', 'file.txt'), 'utf-8')).toBe('p1-contents')
    expect(fs.readFileSync(path.join(agentDir, 'skills', 's1', 'file.txt'), 'utf-8')).toBe('s1-contents')
    expect(fs.readFileSync(path.join(agentDir, 'hooks', 'h1', 'file.txt'), 'utf-8')).toBe('h1-contents')
    fs.rmSync(agentDir, { recursive: true, force: true })
  })

  it('reports installed=false with an error when a local source dir is missing', async () => {
    const repoRoot = tmp  // no templates seeded
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'))
    const manifest = { plugins: [{ name: 'ghost', source: 'local' }], skills: [], hooks: [] }
    const results = await installArtifacts(agentDir, manifest, repoRoot)
    const r = results.find(x => x.name === 'ghost')!
    expect(r.installed).toBe(false)
    expect(r.error).toMatch(/source not found/i)
    fs.rmSync(agentDir, { recursive: true, force: true })
  })

  it('throws on an unsupported source scheme (loud failure)', async () => {
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'))
    const manifest = { plugins: [{ name: 'x', source: 'git:foo/bar#v1' }], skills: [], hooks: [] }
    await expect(installArtifacts(agentDir, manifest, tmp))
      .rejects.toThrow(/unsupported artifact source/i)
    fs.rmSync(agentDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/services/__tests__/artifacts-manifest.test.ts -t installArtifacts`
Expected: FAIL — `installArtifacts` is not exported.

- [ ] **Step 3: Write minimal implementation (append to `artifacts-manifest.ts`)**

```typescript
// append to lib/services/artifacts-manifest.ts
import { cp } from 'fs/promises'
import path from 'path'

export interface InstallResult {
  type: ArtifactType
  name: string
  installed: boolean
  error?: string
}

// Phase 1 supports only the 'local' source: copy infra/templates/<type>/<name>
// into <agentDataDir>/<type>/<name>. Unsupported source schemes throw (loud
// failure) rather than silently producing a capability-less agent.
export async function installArtifacts(
  agentDataDir: string,
  manifest: ArtifactsManifest,
  repoRoot: string,
): Promise<InstallResult[]> {
  const results: InstallResult[] = []
  const types: ArtifactType[] = ['plugins', 'skills', 'hooks']
  for (const type of types) {
    for (const entry of manifest[type]) {
      if (entry.source !== 'local') {
        throw new Error(
          `Unsupported artifact source "${entry.source}" for ${type}/${entry.name} (Phase 1 supports 'local' only)`,
        )
      }
      const srcDir = path.join(repoRoot, 'infra', 'templates', type, entry.name)
      const destDir = path.join(agentDataDir, type, entry.name)
      try {
        await cp(srcDir, destDir, { recursive: true })
        results.push({ type, name: entry.name, installed: true })
      } catch (e) {
        results.push({ type, name: entry.name, installed: false, error: `source not found: ${(e as Error).message}` })
      }
    }
  }
  return results
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/services/__tests__/artifacts-manifest.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add lib/services/artifacts-manifest.ts lib/services/__tests__/artifacts-manifest.test.ts
git commit -m "feat: installArtifacts resolves local sources, reports results, fails loudly"
```

---

## Task 5: Create `infra/artifacts.json` (all current artifacts as `local`)

**Files:**
- Create: `infra/artifacts.json`

- [ ] **Step 1: Write the manifest mirroring the current hardcoded arrays**

```json
{
  "plugins": [
    { "name": "swarm_map_policy", "source": "local" },
    { "name": "boot_md", "source": "local" },
    { "name": "captcha_cascade", "source": "local" }
  ],
  "skills": [
    { "name": "ocr-and-documents", "source": "local" },
    { "name": "captcha-escalation", "source": "local" }
  ],
  "hooks": [
    { "name": "lifecycle-notify", "source": "local" }
  ]
}
```

> Note: this is intentionally identical to `TEMPLATE_PLUGINS = ['swarm_map_policy','boot_md','captcha_cascade']`, `TEMPLATE_SKILLS = ['ocr-and-documents','captcha-escalation']`, `TEMPLATE_HOOKS = ['lifecycle-notify']` in `lib/services/templates.ts` so the refactor is behavior-identical.
> If Phase 0 returned **Verdict B** (enablement required), that is handled in the loader/config, not here — the manifest still lists the same artifacts.

- [ ] **Step 2: Commit**

```bash
git add infra/artifacts.json
git commit -m "feat: add infra/artifacts.json (Phase 1 — all local, mirrors current arrays)"
```

---

## Task 6: Rewire `installBaselineTemplates` to use the manifest + golden-output test

**Files:**
- Modify: `lib/services/templates.ts`
- Modify: `lib/services/__tests__/artifacts-manifest.test.ts` (golden-output test)

- [ ] **Step 1: Write the failing golden-output test (append)**

This proves the new loader copies exactly the artifacts that exist under `infra/templates/`, by comparing the installed agent dir against the real repo templates.

```typescript
// append to lib/services/__tests__/artifacts-manifest.test.ts
import { installBaselineTemplates } from '../templates'

describe('installBaselineTemplates (golden output vs infra/templates)', () => {
  it('installs every artifact listed in infra/artifacts.json with identical bytes', async () => {
    const repoRoot = process.cwd()
    const manifest = loadManifest(path.join(repoRoot, 'infra', 'artifacts.json'))
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-golden-'))
    const results = await installBaselineTemplates(agentDir)

    // Every manifest entry whose template dir exists must be reported installed
    for (const type of ['plugins', 'skills', 'hooks'] as const) {
      for (const entry of manifest[type]) {
        const srcDir = path.join(repoRoot, 'infra', 'templates', type, entry.name)
        if (!fs.existsSync(srcDir)) continue
        const result = results.find(r => r.type === type && r.name === entry.name)
        expect(result?.installed, `${type}/${entry.name} should be installed`).toBe(true)
        // Byte-identical: compare a representative file tree
        const destDir = path.join(agentDir, type, entry.name)
        for (const f of fs.readdirSync(srcDir)) {
          const s = path.join(srcDir, f), d = path.join(destDir, f)
          if (fs.statSync(s).isFile()) {
            expect(fs.readFileSync(d)).toEqual(fs.readFileSync(s))
          }
        }
      }
    }
    fs.rmSync(agentDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/services/__tests__/artifacts-manifest.test.ts -t "golden output"`
Expected: FAIL — `installBaselineTemplates` returns `void` (no `results` to inspect) / signature mismatch.

- [ ] **Step 3: Rewrite `installBaselineTemplates` to delegate to the manifest loader**

Replace the entire body of `lib/services/templates.ts` with:

```typescript
import path from 'path'
import { loadManifest, installArtifacts, type InstallResult } from './artifacts-manifest'

/**
 * Install baseline plugins, skills, and hooks into an agent's data directory,
 * driven by infra/artifacts.json. Phase 1: all entries are 'local' (copied from
 * infra/templates), so output is identical to the previous hardcoded-array copy.
 * Returns what was actually installed (replaces the old void return + the
 * pluginsInstalled = [...TEMPLATE_PLUGINS] lie). Throws on unsupported sources.
 */
export async function installBaselineTemplates(agentDataDir: string): Promise<InstallResult[]> {
  const repoRoot = process.cwd()
  const manifest = loadManifest(path.join(repoRoot, 'infra', 'artifacts.json'))
  return installArtifacts(agentDataDir, manifest, repoRoot)
}

/**
 * @deprecated Read the manifest (infra/artifacts.json) instead. Retained only for
 * callers that still reference the plugin name list; will be removed in Phase 2.
 */
export const TEMPLATE_PLUGINS = ['swarm_map_policy', 'boot_md', 'captcha_cascade']
```

> Rationale: keep `TEMPLATE_PLUGINS` exported (deprecated) so Task 7 can migrate `harness.ts` off it in a focused step rather than breaking the import here. `TEMPLATE_HOOKS`/`TEMPLATE_SKILLS` had no external consumers (per dependency map) and are removed.

- [ ] **Step 4: Run the golden-output test to verify it passes**

Run: `npx vitest run lib/services/__tests__/artifacts-manifest.test.ts`
Expected: PASS (all tests including golden output).

- [ ] **Step 5: Run the broader install-path suites**

Run: `npx vitest run lib/services/__tests__/harness-e2e.test.ts lib/services/__tests__/harness-create.test.ts`
Expected: PASS — `changes.copied` and env assertions unaffected (install still produces the same dirs).

- [ ] **Step 6: Commit**

```bash
git add lib/services/templates.ts lib/services/__tests__/artifacts-manifest.test.ts
git commit -m "refactor: installBaselineTemplates delegates to manifest loader (behavior-identical)"
```

---

## Task 7: Fix `pluginsInstalled` to report actual results

**Files:**
- Modify: `lib/services/harness.ts` (import + the `pluginsInstalled` site ~line 1077, and the `await installBaselineTemplates` site ~235)

- [ ] **Step 1: Update the import in `harness.ts`**

Replace:

```typescript
import { installBaselineTemplates, TEMPLATE_PLUGINS } from './templates'
```

with:

```typescript
import { installBaselineTemplates } from './templates'
```

- [ ] **Step 2: Use the actual install results for `pluginsInstalled`**

At the import-flow call site (~line 1077), replace:

```typescript
    await installBaselineTemplates(workDir)
    const pluginsInstalled = [...TEMPLATE_PLUGINS]
```

with:

```typescript
    const installResults = await installBaselineTemplates(workDir)
    const pluginsInstalled = installResults
      .filter((r) => r.type === 'plugins' && r.installed)
      .map((r) => r.name)
```

- [ ] **Step 3: Confirm the other call site still compiles**

The `scaffoldAgentDir` call site (~line 235) is `await installBaselineTemplates(dataDir)` and discards the result — still valid (now returns a promise of results, still awaited). No change needed. Verify by typecheck in Step 5.

- [ ] **Step 4: Update/strengthen the import-flow test (if one pins `pluginsInstalled`)**

Per the dependency map, no test asserts the literal `pluginsInstalled` contents, but add one to lock the new behavior. Append to `lib/services/__tests__/artifacts-manifest.test.ts`:

```typescript
describe('pluginsInstalled reflects reality', () => {
  it('lists only plugin artifacts that were actually installed', async () => {
    const repoRoot = process.cwd()
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-report-'))
    const results = await installBaselineTemplates(agentDir)
    const plugins = results.filter(r => r.type === 'plugins' && r.installed).map(r => r.name)
    // swarm_map_policy + captcha_cascade exist as templates; assert they are reported
    expect(plugins).toContain('swarm_map_policy')
    expect(plugins).toContain('captcha_cascade')
    // No skill/hook names leak into the plugins list
    expect(plugins).not.toContain('ocr-and-documents')
    fs.rmSync(agentDir, { recursive: true, force: true })
  })
})
```

- [ ] **Step 5: Typecheck + run the full suite**

Run: `npx tsc --noEmit 2>&1 | grep -v "signal-pin.test.ts"`
Expected: no new errors.
Run: `npx vitest run`
Expected: PASS across the suite.

- [ ] **Step 6: Commit**

```bash
git add lib/services/harness.ts lib/services/__tests__/artifacts-manifest.test.ts
git commit -m "refactor: pluginsInstalled reports actual install results, not TEMPLATE_PLUGINS"
```

---

## Task 8: Final verification (Phase 1 done)

- [ ] **Step 1: Full test suite + typecheck**

Run: `npx vitest run`
Expected: all green.
Run: `npx tsc --noEmit 2>&1 | grep -v "signal-pin.test.ts"`
Expected: no new errors.

- [ ] **Step 2: Manual byte-identical sanity check against a real deploy**

Deploy/import a throwaway agent via the HSM API (not docker compose directly), then confirm its `plugins/`, `skills/`, `hooks/` dirs match `infra/templates/` contents — i.e. the manifest refactor produced the same agent dir the old code would have. Record the result.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feature/artifact-commons-design
gh pr create --base main --title "feat: manifest-driven artifact loader (Phase 1) + hsmPort fix" --body "Implements Phase 0 verdict + Phase 1 of docs/specs/2026-06-03-artifact-commons-design.md. Behavior-identical manifest loader, accurate install reporting, loud failure, hsmPort default unified to 3000. No artifacts moved or deleted."
```

---

## Out of Scope (future plans)

- **Phase 2:** extract artifacts to their own repos; `git:#tag` source resolution in `installArtifacts`; build-time fetch token + cache; `boot_md` stale-copy removal (after Phase 0 confirms inert); fold MCP servers into the manifest as references.
- **Phase 3/4:** HSM marketplace UX; per-artifact public visibility flips + pip packaging.
- **`swarm-map` rename** (deferred until OpenClaw support).
