// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  hashArtifactTree,
  planArtifactSync,
  applyArtifactSync,
  readLock,
  ensurePluginsEnabled,
  LOCK_FILE,
} from '../artifacts-sync'
import { ArtifactsManifest } from '../artifacts-manifest'

// Build a fake repo (infra/templates/...) + an agent data dir under a tmpdir.
let repoRoot: string
let dataDir: string

function writeTemplate(type: string, name: string, files: Record<string, string>) {
  const dir = path.join(repoRoot, 'infra', 'templates', type, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    const f = path.join(dir, rel)
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, content)
  }
}
function writeInstalled(type: string, name: string, files: Record<string, string>) {
  const dir = path.join(dataDir, type, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, rel), content)
  }
}
function manifest(m: Partial<ArtifactsManifest>): ArtifactsManifest {
  return { plugins: [], skills: [], hooks: [], ...m }
}

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-sync-'))
  repoRoot = path.join(base, 'repo')
  dataDir = path.join(base, 'data')
  fs.mkdirSync(repoRoot, { recursive: true })
  fs.mkdirSync(dataDir, { recursive: true })
})
afterEach(() => {
  fs.rmSync(path.dirname(repoRoot), { recursive: true, force: true })
})

describe('hashArtifactTree', () => {
  it('is null for a missing dir, stable for identical content, differs on change', () => {
    writeTemplate('plugins', 'a', { 'p.py': 'x=1' })
    const dir = path.join(repoRoot, 'infra/templates/plugins/a')
    expect(hashArtifactTree(path.join(dataDir, 'nope'))).toBeNull()
    const h1 = hashArtifactTree(dir)
    expect(h1).toBe(hashArtifactTree(dir))
    fs.writeFileSync(path.join(dir, 'p.py'), 'x=2')
    expect(hashArtifactTree(dir)).not.toBe(h1)
  })
})

describe('planArtifactSync — no-clobber', () => {
  it('installs a missing artifact', () => {
    writeTemplate('plugins', 'a', { 'p.py': 'x' })
    const plan = planArtifactSync(dataDir, manifest({ plugins: [{ name: 'a', source: 'local', enabled: true }] }), repoRoot)
    expect(plan.items[0]).toMatchObject({ name: 'a', action: 'install', reason: 'missing' })
    expect(plan.enablePlugins).toEqual(['a'])
  })

  it('skips an existing artifact with no lock (untracked — never clobber)', () => {
    writeTemplate('skills', 's', { 'SKILL.md': 'new' })
    writeInstalled('skills', 's', { 'SKILL.md': 'old' })
    const plan = planArtifactSync(dataDir, manifest({ skills: [{ name: 's', source: 'local' }] }), repoRoot)
    expect(plan.items[0]).toMatchObject({ action: 'skip', reason: 'untracked' })
  })

  it('updates a pristine (unmodified-since-install) artifact', () => {
    writeTemplate('plugins', 'a', { 'p.py': 'v1' })
    // simulate an install so the lock records v1's hash, then ship v2
    applyArtifactSync(dataDir, planArtifactSync(dataDir, manifest({ plugins: [{ name: 'a', source: 'local' }] }), repoRoot), repoRoot)
    fs.writeFileSync(path.join(repoRoot, 'infra/templates/plugins/a/p.py'), 'v2')
    const plan = planArtifactSync(dataDir, manifest({ plugins: [{ name: 'a', source: 'local' }] }), repoRoot)
    expect(plan.items[0]).toMatchObject({ action: 'update', reason: 'pristine' })
  })

  it('skips a user-modified artifact even though it is locked', () => {
    writeTemplate('plugins', 'a', { 'p.py': 'v1' })
    applyArtifactSync(dataDir, planArtifactSync(dataDir, manifest({ plugins: [{ name: 'a', source: 'local' }] }), repoRoot), repoRoot)
    // user edits the installed copy
    fs.writeFileSync(path.join(dataDir, 'plugins/a/p.py'), 'hand-edited')
    fs.writeFileSync(path.join(repoRoot, 'infra/templates/plugins/a/p.py'), 'v2')
    const plan = planArtifactSync(dataDir, manifest({ plugins: [{ name: 'a', source: 'local' }] }), repoRoot)
    expect(plan.items[0]).toMatchObject({ action: 'skip', reason: 'user-modified' })
  })

  it('force overrides pristineness and updates anyway', () => {
    writeTemplate('plugins', 'a', { 'p.py': 'v2' })
    writeInstalled('plugins', 'a', { 'p.py': 'hand-edited' })
    const plan = planArtifactSync(dataDir, manifest({ plugins: [{ name: 'a', source: 'local' }] }), repoRoot, { force: true })
    expect(plan.items[0]).toMatchObject({ action: 'update', reason: 'forced' })
  })

  it('skips when the shipped source is missing', () => {
    const plan = planArtifactSync(dataDir, manifest({ plugins: [{ name: 'ghost', source: 'local' }] }), repoRoot)
    expect(plan.items[0]).toMatchObject({ action: 'skip', reason: 'source-missing' })
  })
})

describe('applyArtifactSync', () => {
  it('installs missing files, writes a lock, and never deletes skipped artifacts', () => {
    writeTemplate('plugins', 'fresh', { 'p.py': 'new' })
    writeTemplate('skills', 'keep', { 'SKILL.md': 'shipped' })
    writeInstalled('skills', 'keep', { 'SKILL.md': 'USER OWNED' }) // untracked → must survive
    const m = manifest({
      plugins: [{ name: 'fresh', source: 'local', enabled: true }],
      skills: [{ name: 'keep', source: 'local' }],
    })
    const results = applyArtifactSync(dataDir, planArtifactSync(dataDir, m, repoRoot), repoRoot)

    expect(fs.readFileSync(path.join(dataDir, 'plugins/fresh/p.py'), 'utf-8')).toBe('new')
    expect(fs.readFileSync(path.join(dataDir, 'skills/keep/SKILL.md'), 'utf-8')).toBe('USER OWNED') // untouched
    expect(results.find((r) => r.name === 'fresh')).toMatchObject({ applied: true, action: 'install' })
    expect(results.find((r) => r.name === 'keep')).toMatchObject({ applied: false, action: 'skip' })

    const lock = readLock(dataDir)
    expect(lock!.artifacts.find((a) => a.name === 'fresh')).toBeTruthy() // installed → locked
    expect(lock!.artifacts.find((a) => a.name === 'keep')).toBeFalsy() // skipped → not locked
  })

  it('is idempotent — a second sync re-plans the now-locked artifact as a pristine no-op-or-update', () => {
    writeTemplate('plugins', 'a', { 'p.py': 'v1' })
    const m = manifest({ plugins: [{ name: 'a', source: 'local' }] })
    applyArtifactSync(dataDir, planArtifactSync(dataDir, m, repoRoot), repoRoot)
    const plan2 = planArtifactSync(dataDir, m, repoRoot)
    // unchanged ship → pristine update (a safe re-copy of identical bytes), never skip-untracked
    expect(plan2.items[0].action).toBe('update')
    expect(plan2.items[0].reason).toBe('pristine')
  })
})

describe('ensurePluginsEnabled', () => {
  const cfg = `model:\n  provider: x\n\n# --- Plugins ---\nplugins:\n  enabled:\n    - existing\n\nmemory:\n  memory_enabled: true\n`

  it('appends a new name into an existing enabled list, preserving the rest', () => {
    const { content, added } = ensurePluginsEnabled(cfg, ['captcha_cascade'])
    expect(added).toEqual(['captcha_cascade'])
    expect(content).toContain('    - existing')
    expect(content).toContain('    - captcha_cascade')
    expect(content).toContain('memory_enabled: true')
  })

  it('is idempotent for names already present', () => {
    const { content, added } = ensurePluginsEnabled(cfg, ['existing'])
    expect(added).toEqual([])
    expect(content).toBe(cfg)
  })

  it('appends a fresh plugins block when none exists', () => {
    const bare = `model:\n  provider: x\n`
    const { content, added } = ensurePluginsEnabled(bare, ['p1'])
    expect(added).toEqual(['p1'])
    expect(content).toMatch(/plugins:\s*\n\s+enabled:\s*\n\s+- p1/)
  })

  it('no-ops on empty input', () => {
    expect(ensurePluginsEnabled(cfg, []).content).toBe(cfg)
  })
})
