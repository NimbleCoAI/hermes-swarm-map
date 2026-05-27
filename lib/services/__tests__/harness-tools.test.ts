// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HarnessService } from '../harness'
import { ToolsService, getDefaultToolsForTier } from '../tools'
import { Storage } from '../storage'
import { DockerService } from '../docker'
import { AuditService } from '../audit'
import { ConfigService } from '../config'
import type { Tool, HabitatTier } from '@/lib/types'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('../docker')

const FAKE_TOOLS: Tool[] = [
  { id: 't_safe1', name: 'builtin:search', source: 'builtin', risk: 1, allowedTiers: ['individual', 'team', 'org', 'orgpublic'], reviewed: true, description: 'Safe search' },
  { id: 't_safe2', name: 'builtin:read', source: 'builtin', risk: 2, allowedTiers: ['individual', 'team', 'org', 'orgpublic'], reviewed: true, description: 'Low risk read' },
  { id: 't_med', name: 'mcp:github', source: 'mcp', risk: 3, allowedTiers: ['team', 'org'], reviewed: true, description: 'Medium risk GitHub' },
  { id: 't_high', name: 'mcp:deploy', source: 'mcp', risk: 4, allowedTiers: ['org'], reviewed: false, description: 'High risk deploy' },
  { id: 't_crit', name: 'mcp:admin', source: 'mcp', risk: 5, allowedTiers: ['org'], reviewed: false, description: 'Critical admin' },
  { id: 't_restricted', name: 'mcp:internal', source: 'mcp', risk: 1, allowedTiers: ['org'], reviewed: true, description: 'Low risk but org-only' },
]

describe('getDefaultToolsForTier', () => {
  it('individual tier: only risk 1-2 tools with matching allowedTiers', () => {
    const result = getDefaultToolsForTier('individual', FAKE_TOOLS)
    expect(result).toContain('t_safe1')
    expect(result).toContain('t_safe2')
    expect(result).not.toContain('t_med')
    expect(result).not.toContain('t_high')
    expect(result).not.toContain('t_crit')
    expect(result).not.toContain('t_restricted') // allowedTiers doesn't include individual
  })

  it('team tier: risk 1-3 tools with matching allowedTiers', () => {
    const result = getDefaultToolsForTier('team', FAKE_TOOLS)
    expect(result).toContain('t_safe1')
    expect(result).toContain('t_safe2')
    expect(result).toContain('t_med')
    expect(result).not.toContain('t_high')
    expect(result).not.toContain('t_crit')
    expect(result).not.toContain('t_restricted')
  })

  it('org tier: risk 1-5 tools with matching allowedTiers', () => {
    const result = getDefaultToolsForTier('org', FAKE_TOOLS)
    expect(result).toContain('t_safe1')
    expect(result).toContain('t_safe2')
    expect(result).toContain('t_med')
    expect(result).toContain('t_high')
    expect(result).toContain('t_crit')
    expect(result).toContain('t_restricted')
  })

  it('orgpublic tier: only risk 1-2 tools (conservative, public-facing)', () => {
    const result = getDefaultToolsForTier('orgpublic', FAKE_TOOLS)
    expect(result).toContain('t_safe1')
    expect(result).toContain('t_safe2')
    expect(result).not.toContain('t_med')
    expect(result).not.toContain('t_high')
  })

  it('returns empty array when no tools match', () => {
    const result = getDefaultToolsForTier('individual', [
      { id: 't_x', name: 'high-only', source: 'mcp', risk: 5, allowedTiers: ['org'], reviewed: false, description: '' },
    ])
    expect(result).toEqual([])
  })

  it('respects allowedTiers even when risk level would permit', () => {
    const tools: Tool[] = [
      { id: 't_y', name: 'low-risk-org-only', source: 'builtin', risk: 1, allowedTiers: ['org'], reviewed: true, description: '' },
    ]
    expect(getDefaultToolsForTier('individual', tools)).toEqual([])
    expect(getDefaultToolsForTier('org', tools)).toEqual(['t_y'])
  })
})

describe('HarnessService tools update via updateConfig', () => {
  let tmpDir: string
  let storage: Storage
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-tools-'))
    storage = new Storage(tmpDir)
    const docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates harness tools via updateConfig', () => {
    storage.write('harnesses.json', [
      { id: 'h_test', name: 'test', tools: [], tier: 'individual' },
    ])
    const result = service.updateConfig('h_test', { tools: ['t_safe1', 't_safe2'] })
    expect(result).toBeDefined()

    // Verify persisted
    const stored = storage.read<any[]>('harnesses.json', [])
    const harness = stored.find((h: any) => h.id === 'h_test')
    expect(harness.tools).toEqual(['t_safe1', 't_safe2'])
  })

  it('returns undefined for non-existent harness', () => {
    storage.write('harnesses.json', [])
    const result = service.updateConfig('h_nonexistent', { tools: ['t_safe1'] })
    expect(result).toBeUndefined()
  })
})
