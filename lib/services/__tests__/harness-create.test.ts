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

  it('creates a new harness overlay', () => {
    storage.write('harnesses.json', [])
    const result = service.createOverlay({
      name: 'test-agent',
      tier: 'team',
      platform: 'mattermost',
      channel: 'test-channel',
    })
    expect(result.id).toBe('h_test_agent')
    expect(result.name).toBe('test-agent')
    expect(result.tier).toBe('team')
  })

  it('prevents duplicate names', () => {
    storage.write('harnesses.json', [{ id: 'h_existing', name: 'existing' }])
    expect(() => service.createOverlay({ name: 'existing' })).toThrow()
  })

  it('uses sensible defaults', () => {
    storage.write('harnesses.json', [])
    const result = service.createOverlay({ name: 'minimal' })
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
  })

  it('imports a harness from a data directory', () => {
    storage.write('harnesses.json', [])
    const result = service.importFromDir(hermesDir, 'imported-agent')
    expect(result.name).toBe('imported-agent')
    expect(result.persona).toContain('test agent')
  })

  it('detects persona from SOUL.md', () => {
    storage.write('harnesses.json', [])
    const result = service.importFromDir(hermesDir, 'soul-test')
    expect(result.persona).toBeTruthy()
    expect(result.persona!.length).toBeGreaterThan(0)
  })
})
