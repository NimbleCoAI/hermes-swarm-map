// @vitest-environment node
//
// D1: the `personal` harness's data lives at ~/.hermes (guessDataDir special-
// cases it), but duplicateOverlay() and remove() hardcoded ~/.hermes-${name} →
// ~/.hermes-personal, which doesn't exist. Duplicating personal produced an
// empty clone; deleting it targeted the wrong dir. Reachable once personal has
// been persisted as an overlay (e.g. after setting its model cascade).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HarnessService } from '../harness'
import { Storage } from '../storage'
import { DockerService } from '../docker'
import { AuditService } from '../audit'
import { ConfigService } from '../config'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('../docker')

describe('HarnessService — personal data dir (D1)', () => {
  let tmpDir: string
  let homeDir: string
  let storage: Storage
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-personal-'))
    homeDir = path.join(tmpDir, 'home')
    fs.mkdirSync(homeDir, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir)
    storage = new Storage(tmpDir)
    storage.write('settings.json', { dataDir: tmpDir }) // keep compose in tmp
    service = new HarnessService(storage, new DockerService(), new AuditService(storage), new ConfigService(storage))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('duplicates personal from ~/.hermes, not the nonexistent ~/.hermes-personal', async () => {
    // personal's real data — note it lives at ~/.hermes
    const personalDir = path.join(homeDir, '.hermes')
    fs.mkdirSync(personalDir, { recursive: true })
    fs.writeFileSync(
      path.join(personalDir, '.env'),
      'HERMES_AGENT_NAME=personal\nAPI_SERVER_PORT=8642\nCUSTOM_MARKER=copied-from-personal\n',
      { mode: 0o600 },
    )
    fs.writeFileSync(path.join(personalDir, 'SOUL.md'), '# personal\n')
    storage.write('harnesses.json', [{ id: 'h_personal', name: 'personal', tier: 'individual' }])

    await service.duplicateOverlay('h_personal', 'personal-copy')

    // The clone must be a real copy of ~/.hermes — the marker proves it, an
    // empty scaffold would not contain it.
    const env = fs.readFileSync(path.join(homeDir, '.hermes-personal-copy', '.env'), 'utf-8')
    expect(env).toContain('CUSTOM_MARKER=copied-from-personal')
  })

  it('remove() deletes a normal harness data dir at ~/.hermes-<name>', () => {
    const dir = path.join(homeDir, '.hermes-foo')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, '.env'), 'X=1\n')
    storage.write('harnesses.json', [{ id: 'h_foo', name: 'foo' }])

    const res = service.remove('h_foo', true)
    expect(res.filesDeleted).toBe(true)
    expect(fs.existsSync(dir)).toBe(false)
  })

  it('remove() never deletes the personal base dir ~/.hermes', () => {
    const personalDir = path.join(homeDir, '.hermes')
    fs.mkdirSync(personalDir, { recursive: true })
    fs.writeFileSync(path.join(personalDir, '.env'), 'HERMES_AGENT_NAME=personal\n')
    storage.write('harnesses.json', [{ id: 'h_personal', name: 'personal' }])

    service.remove('h_personal', true)
    // ~/.hermes is the base install — a dashboard delete must not nuke it.
    expect(fs.existsSync(personalDir)).toBe(true)
  })
})
