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

describe('HarnessService.duplicate', () => {
  let tmpDir: string
  let storage: Storage
  let docker: DockerService
  let audit: AuditService
  let config: ConfigService
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-dup-'))
    storage = new Storage(tmpDir)
    docker = new DockerService()
    audit = new AuditService(storage)
    config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('duplicates a harness overlay with a new name', async () => {
    // Set up an existing overlay
    storage.write('harnesses.json', [
      { id: 'h_personal', name: 'personal', tier: 'individual', platform: 'mattermost', channel: 'sanctum', tools: ['t_web'], models: ['claude-sonnet-4'] },
    ])

    const result = await service.duplicateOverlay('h_personal', 'personal-v2')
    expect(result).toBeDefined()
    expect(result!.id).toBe('h_personal_v2')
    expect(result!.name).toBe('personal-v2')
    expect(result!.tier).toBe('individual')
    expect(result!.tools).toEqual(['t_web'])

    // Original should still exist
    const overlays = storage.read<any[]>('harnesses.json', [])
    expect(overlays).toHaveLength(2)
  })

  it('returns undefined when source overlay does not exist', async () => {
    storage.write('harnesses.json', [])
    const result = await service.duplicateOverlay('h_nonexistent', 'new-name')
    expect(result).toBeUndefined()
  })

  it('generates unique id from name', async () => {
    storage.write('harnesses.json', [
      { id: 'h_personal', name: 'personal', tier: 'team' },
    ])
    const result = await service.duplicateOverlay('h_personal', 'my-new-agent')
    expect(result!.id).toBe('h_my_new_agent')
  })

  it('logs duplication to audit', async () => {
    storage.write('harnesses.json', [
      { id: 'h_personal', name: 'personal', tier: 'individual' },
    ])
    await service.duplicateOverlay('h_personal', 'personal-copy')
    const entries = audit.query({})
    expect(entries).toHaveLength(1)
    expect(entries[0].what).toBe('duplicate')
    expect(entries[0].target).toContain('personal')
  })
})

// Identity reset on duplicate (issue #61): a duplicate must NOT inherit the source's
// HERMES_AGENT_NAME (the HSM policy identity) or SOUL.md (persona/name).
describe('HarnessService.duplicate — identity reset', () => {
  let tmpDir: string
  let homeDir: string
  let storage: Storage
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-dupid-'))
    homeDir = path.join(tmpDir, 'home')
    fs.mkdirSync(homeDir, { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(homeDir)
    storage = new Storage(tmpDir)
    storage.write('settings.json', { dataDir: tmpDir }) // keep compose in tmp
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, new DockerService(), audit, config)

    // Source agent with a real data dir, identity baked in.
    storage.write('harnesses.json', [{ id: 'h_srcagent', name: 'srcagent', tier: 'team' }])
    const srcDir = path.join(homeDir, '.hermes-srcagent')
    fs.mkdirSync(srcDir, { recursive: true })
    fs.writeFileSync(
      path.join(srcDir, '.env'),
      'HERMES_AGENT_NAME=srcagent\nAPI_SERVER_PORT=8642\nSIGNAL_ACCOUNT=+15550001111\n',
      { mode: 0o600 },
    )
    fs.writeFileSync(path.join(srcDir, 'SOUL.md'), '# srcagent\n\nYou are **srcagent**.\n')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('resets HERMES_AGENT_NAME to the new name', async () => {
    await service.duplicateOverlay('h_srcagent', 'dupagent')
    const env = fs.readFileSync(path.join(homeDir, '.hermes-dupagent', '.env'), 'utf-8')
    expect(env).toMatch(/^HERMES_AGENT_NAME=dupagent$/m)
    expect(env).not.toMatch(/^HERMES_AGENT_NAME=srcagent$/m)
  })

  it('regenerates SOUL.md with the new name and no source-name references', async () => {
    await service.duplicateOverlay('h_srcagent', 'dupagent')
    const soul = fs.readFileSync(path.join(homeDir, '.hermes-dupagent', 'SOUL.md'), 'utf-8')
    expect(soul).toContain('dupagent')
    expect(soul).not.toContain('srcagent')
  })

  it('still strips surface credentials (regression)', async () => {
    await service.duplicateOverlay('h_srcagent', 'dupagent')
    const env = fs.readFileSync(path.join(homeDir, '.hermes-dupagent', '.env'), 'utf-8')
    expect(env).not.toMatch(/^SIGNAL_ACCOUNT=/m)
  })
})
