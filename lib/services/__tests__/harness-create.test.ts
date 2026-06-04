// @vitest-environment node
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

describe('HarnessService.createOverlay', () => {
  let tmpDir: string
  let storage: Storage
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-create-'))
    storage = new Storage(tmpDir)
    const docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates a new harness overlay', async () => {
    storage.write('harnesses.json', [])
    const result = await service.createOverlay({
      name: 'test-agent',
      tier: 'team',
      platform: 'mattermost',
      channel: 'test-channel',
    })
    expect(result.id).toBe('h_test_agent')
    expect(result.name).toBe('test-agent')
    expect(result.tier).toBe('team')
  })

  it('prevents duplicate names', async () => {
    storage.write('harnesses.json', [{ id: 'h_existing', name: 'existing' }])
    await expect(service.createOverlay({ name: 'existing' })).rejects.toThrow()
  })

  it('uses sensible defaults', async () => {
    storage.write('harnesses.json', [])
    const result = await service.createOverlay({ name: 'minimal' })
    expect(result.tier).toBe('individual')
    expect(result.platform).toBe('hermes')
  })
})

describe('HarnessService.importFromDir', () => {
  let tmpDir: string
  let hermesDir: string
  let storage: Storage
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-import-'))
    hermesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-agent-'))
    storage = new Storage(tmpDir)
    const docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)

    // Create a fake hermes data dir
    fs.writeFileSync(path.join(hermesDir, 'SOUL.md'), '# Test Agent\nI am a test agent.')
    fs.writeFileSync(path.join(hermesDir, '.env'), 'ANTHROPIC_API_KEY=sk-ant-test123\nAPI_SERVER_PORT=8642\n')
    fs.mkdirSync(path.join(hermesDir, 'memories'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(hermesDir, { recursive: true, force: true })
    // Clean up copied agent dirs
    for (const name of ['imported-agent', 'soul-test', 'gitcred-test']) {
      const dir = path.join(os.homedir(), `.hermes-${name}`)
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('imports a harness from a data directory', async () => {
    storage.write('harnesses.json', [])
    const result = await service.importFromDir(hermesDir, 'imported-agent')
    expect(result.name).toBe('imported-agent')
    expect(result.changes.copied).toBe(true)
    expect(result.destDir).toBe(path.join(os.homedir(), '.hermes-imported-agent'))
    // Verify the overlay was registered with persona
    const overlays = storage.read<any[]>('harnesses.json', [])
    const overlay = overlays.find((h: any) => h.name === 'imported-agent')
    expect(overlay).toBeDefined()
    expect(overlay.persona).toContain('test agent')
  })

  it('does NOT write git credentials on import — the runtime provisions them at boot', async () => {
    storage.write('harnesses.json', [])
    fs.writeFileSync(
      path.join(hermesDir, '.env'),
      'ANTHROPIC_API_KEY=sk-ant-test123\nGITHUB_TOKEN=github_pat_IMPORTED\n',
    )
    const result = await service.importFromDir(hermesDir, 'gitcred-test')
    // Git credential provisioning moved into the agent runtime (a cont-init boot
    // hook reads the agent's own .env). HSM no longer writes these files, so it
    // can't clobber a user's git setup and there's no second source of truth.
    const credPath = path.join(result.destDir, 'home', '.git-credentials')
    expect(fs.existsSync(credPath)).toBe(false)
  })

  it('detects persona from SOUL.md', async () => {
    storage.write('harnesses.json', [])
    const result = await service.importFromDir(hermesDir, 'soul-test')
    // Verify persona was stored in the overlay
    const overlays = storage.read<any[]>('harnesses.json', [])
    const overlay = overlays.find((h: any) => h.name === 'soul-test')
    expect(overlay).toBeDefined()
    expect(overlay.persona).toBeTruthy()
    expect(overlay.persona.length).toBeGreaterThan(0)
  })
})
