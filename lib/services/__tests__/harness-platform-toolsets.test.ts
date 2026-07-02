// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HarnessService } from '../harness'
import { ToolsService } from '../tools'
import { Storage } from '../storage'
import { DockerService } from '../docker'
import { AuditService } from '../audit'
import { ConfigService } from '../config'
import { generateDefaultConfig } from '../../templates/config-yaml'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('../docker')

describe('platform_toolsets discovery (BUG 2)', () => {
  let tmpDir: string
  let storage: Storage
  let tools: ToolsService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-plat-ts-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
    storage = new Storage(tmpDir)
    tools = new ToolsService(storage)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('discoverForHarness surfaces platform_toolsets from a generated config.yaml (no mcp_servers)', () => {
    // A freshly-created agent's config.yaml has platform_toolsets but no
    // mcp_servers — discovery must not come up empty ("No tools found").
    const agentDir = path.join(tmpDir, '.hermes-freshagent')
    fs.mkdirSync(agentDir, { recursive: true })
    const config = generateDefaultConfig({ provider: 'anthropic', primaryModel: 'claude-sonnet-4-6' })
    expect(config).toContain('platform_toolsets:')
    expect(config).not.toContain('mcp_servers:')
    fs.writeFileSync(path.join(agentDir, 'config.yaml'), config)

    const discovered = tools.discoverForHarness('freshagent')
    expect(discovered.length).toBeGreaterThan(0)

    // The discovered tools should include the platform toolset entries.
    const full = tools.discover(['freshagent'])
    const names = full.map((t) => t.name)
    expect(names.some((n) => n.includes('hermes-cli'))).toBe(true)
    expect(names.some((n) => n.includes('hermes-signal'))).toBe(true)
  })
})

describe('overlay tools:[] still auto-discovers (BUG 2 — line 811 guard)', () => {
  let tmpDir: string
  let storage: Storage
  let service: HarnessService
  let docker: DockerService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-guard-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
    storage = new Storage(tmpDir)
    docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)
    service.setToolsService(new ToolsService(storage))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('a running agent with overlay tools:[] surfaces auto-discovered platform toolsets', () => {
    // Compose file the discover() path will match against.
    const composeFile = path.join(tmpDir, 'docker-compose.yml')
    fs.writeFileSync(composeFile, 'services: {}\n')
    storage.write('settings.json', {
      hermesDir: tmpDir,
      dataDir: tmpDir,
      theme: 'light',
      composeFiles: [composeFile],
    })

    // Agent data dir with a generated config.yaml (platform_toolsets, no mcp).
    const agentDir = path.join(tmpDir, '.hermes-testagent')
    fs.mkdirSync(agentDir, { recursive: true })
    fs.writeFileSync(
      path.join(agentDir, 'config.yaml'),
      generateDefaultConfig({ provider: 'anthropic', primaryModel: 'claude-sonnet-4-6' })
    )

    // Overlay explicitly stores an EMPTY tools array (the createOverlay seed).
    storage.write('harnesses.json', [
      { id: 'h_testagent', name: 'testagent', tools: [], tier: 'individual' },
    ])

    // Docker mocks: one running hermes container backed by our compose file.
    ;(docker.isAvailable as any).mockReturnValue(true)
    ;(docker.listComposeProjects as any).mockReturnValue([
      { name: 'proj', status: 'running', configFiles: [composeFile] },
    ])
    ;(docker.inspectContainers as any).mockReturnValue([
      {
        name: 'hermes-testagent',
        service: 'hermes-testagent',
        state: 'running',
        status: 'Up',
        ports: [{ published: 8642, target: 8000 }],
        composeFile,
      },
    ])
    ;(docker.getAllContainerStats as any).mockReturnValue({})
    ;(docker.listContainers as any).mockReturnValue([])

    const { harnesses } = service.discover()
    const agent = harnesses.find((h) => h.id === 'h_testagent')
    expect(agent).toBeDefined()
    // Before the fix, `overlay.tools ?? autoDiscover` returns [] because
    // [] ?? x === []. The guard must fall back to auto-discovery.
    expect(agent!.tools.length).toBeGreaterThan(0)
  })
})
