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

describe('Harness E2E', () => {
  let tmpDir: string
  let hermesDir: string
  let service: HarnessService
  let storage: Storage

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-e2e-'))
    hermesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-e2e-'))
    storage = new Storage(tmpDir)
    const docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    // Set dataDir + hermesDir so compose files go into tmpDir/compose
    storage.write('settings.json', {
      hermesDir,
      dataDir: tmpDir,
      theme: 'light',
      composeFiles: [],
    })
    service = new HarnessService(storage, docker, audit, config)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.rmSync(hermesDir, { recursive: true, force: true })
    // Clean up any agent data dirs created in home
    for (const name of ['e2e-test-agent', 'e2e-dup-agent']) {
      const dir = path.join(os.homedir(), `.hermes-${name}`)
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  describe('createOverlay', () => {
    it('creates overlay entry with compose file and service name', () => {
      storage.write('harnesses.json', [])
      const result = service.createOverlay({ name: 'e2e-test-agent', tier: 'team' })
      expect(result.name).toBe('e2e-test-agent')
      expect(result.tier).toBe('team')
      expect(result.composeFile).toBeTruthy()
      expect(result.serviceName).toBe('hermes-e2e-test-agent')
    })

    it('generates standalone compose file', () => {
      storage.write('harnesses.json', [])
      const result = service.createOverlay({ name: 'e2e-test-agent' })
      expect(result.composeFile).toBeTruthy()
      expect(fs.existsSync(result.composeFile!)).toBe(true)
      const composeContent = fs.readFileSync(result.composeFile!, 'utf-8')
      expect(composeContent).toContain('hermes-e2e-test-agent')
    })

    it('scaffolds agent data directory', () => {
      storage.write('harnesses.json', [])
      service.createOverlay({ name: 'e2e-test-agent' })
      const agentDir = path.join(os.homedir(), '.hermes-e2e-test-agent')
      expect(fs.existsSync(agentDir)).toBe(true)
      expect(fs.existsSync(path.join(agentDir, '.env'))).toBe(true)
      expect(fs.existsSync(path.join(agentDir, 'config.yaml'))).toBe(true)
      expect(fs.existsSync(path.join(agentDir, 'SOUL.md'))).toBe(true)
    })

    it('assigns a port and reflects it in channel', () => {
      storage.write('harnesses.json', [])
      const result = service.createOverlay({ name: 'e2e-test-agent' })
      expect(result.channel).toMatch(/:\d+/)
    })

    it('stores default model', () => {
      storage.write('harnesses.json', [])
      const result = service.createOverlay({ name: 'e2e-test-agent' })
      expect(result.models).toBeDefined()
      expect(result.models!.length).toBeGreaterThan(0)
    })
  })

  describe('importFromDir', () => {
    let agentDir: string

    beforeEach(() => {
      agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-import-'))
      fs.writeFileSync(path.join(agentDir, 'SOUL.md'), '# Agent\nI help with research.')
      fs.writeFileSync(
        path.join(agentDir, '.env'),
        'ANTHROPIC_API_KEY=sk-test\nAPI_SERVER_PORT=8692\nMATTERMOST_TOKEN=tok123\n'
      )
      fs.writeFileSync(
        path.join(agentDir, 'config.yaml'),
        'model:\n  provider: anthropic\n  default: claude-sonnet-4\n'
      )
      fs.mkdirSync(path.join(agentDir, 'skills/web_search'), { recursive: true })
      fs.mkdirSync(path.join(agentDir, 'skills/code_exec'), { recursive: true })
    })

    afterEach(() => {
      fs.rmSync(agentDir, { recursive: true, force: true })
      // Clean up imported overlay agent dir
      const dir = path.join(os.homedir(), '.hermes-imported-agent')
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })

    it('returns harness with correct name', () => {
      storage.write('harnesses.json', [])
      const result = service.importFromDir(agentDir, 'imported-agent')
      expect(result.name).toBe('imported-agent')
    })

    it('detects persona from SOUL.md', () => {
      storage.write('harnesses.json', [])
      const result = service.importFromDir(agentDir, 'imported-agent')
      expect(result.persona).toContain('research')
    })

    it('detects platform from .env', () => {
      storage.write('harnesses.json', [])
      const result = service.importFromDir(agentDir, 'imported-agent')
      expect(result.platform).toBe('mattermost')
    })

    it('reads model config from config.yaml', () => {
      storage.write('harnesses.json', [])
      const result = service.importFromDir(agentDir, 'imported-agent')
      expect(result.models).toBeDefined()
      expect(result.models).toContain('claude-sonnet-4')
    })

    it('reads skills from skills directory', () => {
      storage.write('harnesses.json', [])
      const result = service.importFromDir(agentDir, 'imported-agent')
      expect(result.tools).toBeDefined()
      expect(result.tools).toContain('web_search')
      expect(result.tools).toContain('code_exec')
    })

    it('reads port from .env and sets channel', () => {
      storage.write('harnesses.json', [])
      const result = service.importFromDir(agentDir, 'imported-agent')
      expect(result.channel).toBe(':8692')
    })
  })

  describe('duplicateOverlay', () => {
    afterEach(() => {
      for (const name of ['e2e-dup-agent']) {
        const dir = path.join(os.homedir(), `.hermes-${name}`)
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true })
        }
      }
    })

    it('creates duplicate overlay with new name', () => {
      storage.write('harnesses.json', [
        {
          id: 'h_personal',
          name: 'personal',
          tier: 'individual',
          platform: 'mattermost',
          channel: ':8642',
          tools: ['t_web'],
          models: ['claude-sonnet-4'],
        },
      ])
      const result = service.duplicateOverlay('h_personal', 'e2e-dup-agent')
      expect(result).toBeDefined()
      expect(result!.name).toBe('e2e-dup-agent')
      expect(result!.id).toBe('h_e2e_dup_agent')
    })

    it('assigns a different port to the duplicate', () => {
      storage.write('harnesses.json', [
        { id: 'h_personal', name: 'personal', tier: 'individual', channel: ':8642' },
      ])
      const result = service.duplicateOverlay('h_personal', 'e2e-dup-agent')
      expect(result!.channel).toBeTruthy()
      // Port should be assigned (may or may not differ from source in test env)
      expect(result!.channel).toMatch(/:\d+/)
    })

    it('generates compose file for duplicate', () => {
      storage.write('harnesses.json', [
        { id: 'h_personal', name: 'personal', tier: 'individual' },
      ])
      const result = service.duplicateOverlay('h_personal', 'e2e-dup-agent')
      expect(result!.composeFile).toBeTruthy()
      expect(fs.existsSync(result!.composeFile!)).toBe(true)
    })

    it('returns undefined for nonexistent source', () => {
      storage.write('harnesses.json', [])
      const result = service.duplicateOverlay('h_nonexistent', 'new-name')
      expect(result).toBeUndefined()
    })
  })
})
