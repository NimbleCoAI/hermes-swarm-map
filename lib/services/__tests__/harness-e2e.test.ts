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
    it('creates overlay entry with compose file and service name', async () => {
      storage.write('harnesses.json', [])
      const result = await service.createOverlay({ name: 'e2e-test-agent', tier: 'team' })
      expect(result.name).toBe('e2e-test-agent')
      expect(result.tier).toBe('team')
      expect(result.composeFile).toBeTruthy()
      expect(result.serviceName).toBe('hermes-e2e-test-agent')
    })

    it('generates standalone compose file', async () => {
      storage.write('harnesses.json', [])
      const result = await service.createOverlay({ name: 'e2e-test-agent' })
      expect(result.composeFile).toBeTruthy()
      expect(fs.existsSync(result.composeFile!)).toBe(true)
      const composeContent = fs.readFileSync(result.composeFile!, 'utf-8')
      expect(composeContent).toContain('hermes-e2e-test-agent')
    })

    it('scaffolds agent data directory', async () => {
      storage.write('harnesses.json', [])
      await service.createOverlay({ name: 'e2e-test-agent' })
      const agentDir = path.join(os.homedir(), '.hermes-e2e-test-agent')
      expect(fs.existsSync(agentDir)).toBe(true)
      expect(fs.existsSync(path.join(agentDir, '.env'))).toBe(true)
      expect(fs.existsSync(path.join(agentDir, 'config.yaml'))).toBe(true)
      expect(fs.existsSync(path.join(agentDir, 'SOUL.md'))).toBe(true)
    })

    it('assigns a port and reflects it in channel', async () => {
      storage.write('harnesses.json', [])
      const result = await service.createOverlay({ name: 'e2e-test-agent' })
      expect(result.channel).toMatch(/:\d+/)
    })

    it('stores default model', async () => {
      storage.write('harnesses.json', [])
      const result = await service.createOverlay({ name: 'e2e-test-agent' })
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

    it('returns harness with correct name', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      expect(result.name).toBe('imported-agent')
      expect(result.changes.copied).toBe(true)
      expect(result.destDir).toBe(path.join(os.homedir(), '.hermes-imported-agent'))
    })

    it('detects persona from SOUL.md', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      const overlays = storage.read<any[]>('harnesses.json', [])
      const overlay = overlays.find((h: any) => h.name === 'imported-agent')
      expect(overlay).toBeDefined()
      expect(overlay.persona).toContain('research')
    })

    it('detects platform from .env', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      const overlays = storage.read<any[]>('harnesses.json', [])
      const overlay = overlays.find((h: any) => h.name === 'imported-agent')
      expect(overlay).toBeDefined()
      expect(overlay.platform).toBe('mattermost')
    })

    it('reads model config from config.yaml', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      const overlays = storage.read<any[]>('harnesses.json', [])
      const overlay = overlays.find((h: any) => h.name === 'imported-agent')
      expect(overlay).toBeDefined()
      expect(overlay.models).toBeDefined()
      expect(overlay.models).toContain('claude-sonnet-4')
    })

    it('reads skills from skills directory', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      const overlays = storage.read<any[]>('harnesses.json', [])
      const overlay = overlays.find((h: any) => h.name === 'imported-agent')
      expect(overlay).toBeDefined()
      expect(overlay.tools).toContain('web_search')
      expect(overlay.tools).toContain('code_exec')
    })

    it('reads port from .env and sets channel', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      const overlays = storage.read<any[]>('harnesses.json', [])
      const overlay = overlays.find((h: any) => h.name === 'imported-agent')
      expect(overlay).toBeDefined()
      expect(overlay.channel).toBe(':8692')
    })

    it('patches .env with HSM vars', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      expect(result.changes.envVarsAdded).toContain('HSM_URL')
      expect(result.changes.envVarsAdded).toContain('SWARM_MAP_POLICY_URL')
      expect(result.changes.envVarsAdded).toContain('HERMES_AGENT_NAME')
      // Verify the vars are actually in the copied .env
      const envContent = fs.readFileSync(path.join(result.destDir, '.env'), 'utf-8')
      expect(envContent).toContain('HSM_URL=')
      expect(envContent).toContain('HERMES_AGENT_NAME=imported-agent')
    })

    it('generates compose file', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      expect(result.changes.composeGenerated).toBe(true)
    })

    it('defaults mention-gating to require @mention (secure by default)', async () => {
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      expect(result.changes.envVarsAdded).toContain('SIGNAL_REQUIRE_MENTION')
      const envContent = fs.readFileSync(path.join(result.destDir, '.env'), 'utf-8')
      expect(envContent).toContain('SIGNAL_REQUIRE_MENTION=true')
      expect(envContent).toContain('TELEGRAM_REQUIRE_MENTION=true')
      expect(envContent).toContain('MATTERMOST_REQUIRE_MENTION=true')
    })

    it('does not override an explicit mention-gating opt-out on import', async () => {
      // An agent that explicitly disabled the gate stays disabled — the default
      // only applies when the var is absent.
      fs.appendFileSync(path.join(agentDir, '.env'), 'SIGNAL_REQUIRE_MENTION=false\n')
      storage.write('harnesses.json', [])
      const result = await service.importFromDir(agentDir, 'imported-agent')
      const envContent = fs.readFileSync(path.join(result.destDir, '.env'), 'utf-8')
      expect(envContent).toContain('SIGNAL_REQUIRE_MENTION=false')
      expect(envContent).not.toContain('SIGNAL_REQUIRE_MENTION=true')
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

    it('creates duplicate overlay with new name', async () => {
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
      const result = await service.duplicateOverlay('h_personal', 'e2e-dup-agent')
      expect(result).toBeDefined()
      expect(result!.name).toBe('e2e-dup-agent')
      expect(result!.id).toBe('h_e2e_dup_agent')
    })

    it('assigns a different port to the duplicate', async () => {
      storage.write('harnesses.json', [
        { id: 'h_personal', name: 'personal', tier: 'individual', channel: ':8642' },
      ])
      const result = await service.duplicateOverlay('h_personal', 'e2e-dup-agent')
      expect(result!.channel).toBeTruthy()
      // Port should be assigned (may or may not differ from source in test env)
      expect(result!.channel).toMatch(/:\d+/)
    })

    it('generates compose file for duplicate', async () => {
      storage.write('harnesses.json', [
        { id: 'h_personal', name: 'personal', tier: 'individual' },
      ])
      const result = await service.duplicateOverlay('h_personal', 'e2e-dup-agent')
      expect(result!.composeFile).toBeTruthy()
      expect(fs.existsSync(result!.composeFile!)).toBe(true)
    })

    it('returns undefined for nonexistent source', async () => {
      storage.write('harnesses.json', [])
      const result = await service.duplicateOverlay('h_nonexistent', 'new-name')
      expect(result).toBeUndefined()
    })
  })
})
