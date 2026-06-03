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
