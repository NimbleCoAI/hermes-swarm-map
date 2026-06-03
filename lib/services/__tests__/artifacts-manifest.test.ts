import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { loadManifest, installArtifacts } from '../artifacts-manifest'

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

describe('installArtifacts (local source)', () => {
  function seedTemplates(root: string) {
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
    const repoRoot = tmp
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

import { installBaselineTemplates } from '../templates'

describe('installBaselineTemplates (golden output vs infra/templates)', () => {
  it('installs every artifact listed in infra/artifacts.json with identical bytes', async () => {
    const repoRoot = process.cwd()
    const manifest = loadManifest(path.join(repoRoot, 'infra', 'artifacts.json'))
    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-golden-'))
    const results = await installBaselineTemplates(agentDir)

    for (const type of ['plugins', 'skills', 'hooks'] as const) {
      for (const entry of manifest[type]) {
        const srcDir = path.join(repoRoot, 'infra', 'templates', type, entry.name)
        if (!fs.existsSync(srcDir)) continue
        const result = results.find(r => r.type === type && r.name === entry.name)
        expect(result?.installed, `${type}/${entry.name} should be installed`).toBe(true)
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
