import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HarnessService } from '../harness'
import { Storage } from '../storage'
import { DockerService } from '../docker'
import { AuditService } from '../audit'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Harness, HabitatTier } from '@/lib/types'

vi.mock('../docker')

function makeHarness(overrides: Partial<Harness> = {}): Harness {
  return {
    id: 'h_test',
    name: 'test',
    runtime: 'hermes',
    status: 'running',
    health: { errors: 0 },
    persona: 'Test bot',
    tier: 'individual',
    platform: 'hermes',
    channel: ':8642',
    lastSeen: Date.now(),
    models: ['claude-sonnet-4-5'],
    costToday: 0,
    invocations: 0,
    cpu: 0,
    mem: 0,
    tools: [],
    ...overrides,
  }
}

describe('HarnessService.updateTier', () => {
  let tmpDir: string
  let storage: Storage
  let docker: DockerService
  let audit: AuditService
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-tier-'))
    storage = new Storage(tmpDir)
    docker = new DockerService()
    audit = new AuditService(storage)
    service = new HarnessService(storage, docker, audit)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('updates tier from individual to team', () => {
    storage.write('harnesses.json', [makeHarness()])
    const result = service.updateConfig('h_test', { tier: 'team' })
    expect(result).toBeDefined()
    expect(result!.tier).toBe('team')

    // Verify it persisted
    const reloaded = service.get('h_test')
    expect(reloaded!.tier).toBe('team')
  })

  it('updates tier to all valid values', () => {
    const validTiers: HabitatTier[] = ['individual', 'team', 'org', 'orgpublic', 'public']
    storage.write('harnesses.json', [makeHarness()])

    for (const tier of validTiers) {
      service.updateConfig('h_test', { tier })
      const h = service.get('h_test')
      expect(h!.tier).toBe(tier)
    }
  })

  it('returns undefined for non-existent harness', () => {
    storage.write('harnesses.json', [])
    const result = service.updateConfig('h_nonexistent', { tier: 'team' })
    expect(result).toBeUndefined()
  })

  it('preserves other fields when updating tier', () => {
    storage.write('harnesses.json', [makeHarness({ persona: 'My bot', models: ['claude-sonnet-4-5'] })])
    service.updateConfig('h_test', { tier: 'org' })
    const h = service.get('h_test')
    expect(h!.tier).toBe('org')
    expect(h!.persona).toBe('My bot')
    expect(h!.models).toEqual(['claude-sonnet-4-5'])
  })
})
