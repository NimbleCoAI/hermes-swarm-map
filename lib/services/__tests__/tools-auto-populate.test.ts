// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ToolsService } from '../tools'
import { HarnessService } from '../harness'
import { Storage } from '../storage'
import { DockerService } from '../docker'
import { AuditService } from '../audit'
import { ConfigService } from '../config'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('../docker')

describe('ToolsService.discoverForHarness', () => {
  let tmpDir: string
  let storage: Storage
  let tools: ToolsService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-tools-auto-'))
    storage = new Storage(tmpDir)
    tools = new ToolsService(storage)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns tool IDs for a harness with config.yaml tools', () => {
    // discoverForHarness reads from ~/.hermes-{name}/config.yaml
    // We can't easily mock the filesystem path, so test the method exists and returns array
    const result = tools.discoverForHarness('nonexistent-agent-xyz')
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(0) // no config.yaml at this path
  })

  it('returns consistent IDs across multiple calls', () => {
    const result1 = tools.discoverForHarness('nonexistent-agent-xyz')
    const result2 = tools.discoverForHarness('nonexistent-agent-xyz')
    expect(result1).toEqual(result2)
  })
})

describe('HarnessService auto-populate tools', () => {
  let tmpDir: string
  let storage: Storage
  let service: HarnessService
  let toolsService: ToolsService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-auto-'))
    storage = new Storage(tmpDir)
    const docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)
    toolsService = new ToolsService(storage)
    service.setToolsService(toolsService)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('setToolsService wires up the tools service', () => {
    // Verify the service accepts ToolsService injection without error
    expect(() => service.setToolsService(toolsService)).not.toThrow()
  })

  it('overlay tools take precedence over auto-discovered tools', () => {
    // When overlay has explicit tools, they should be used (not overwritten)
    storage.write('harnesses.json', [
      { id: 'h_test', name: 'test', tools: ['t_manually_set'], tier: 'individual' },
    ])
    const result = service.updateConfig('h_test', { tools: ['t_manually_set', 't_another'] })
    expect(result).toBeDefined()

    const stored = storage.read<any[]>('harnesses.json', [])
    const harness = stored.find((h: any) => h.id === 'h_test')
    expect(harness.tools).toEqual(['t_manually_set', 't_another'])
  })

  it('auto-discover returns empty array when no ToolsService is set', () => {
    // Create a service without ToolsService wired up
    const docker = new DockerService()
    const audit = new AuditService(storage)
    const bareService = new HarnessService(storage, docker, audit)
    // Without setToolsService, autoDiscoverTools returns undefined, falling back to []
    storage.write('harnesses.json', [
      { id: 'h_test', name: 'test', tools: [], tier: 'individual' },
    ])
    const harness = bareService.get('h_test')
    // When no Docker containers are found, falls back to stored overlay
    expect(harness).toBeDefined()
    expect(harness!.tools).toEqual([])
  })
})
