import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HarnessService } from '../harness'
import { Storage } from '../storage'
import { DockerService } from '../docker'
import { AuditService } from '../audit'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('../docker')

describe('HarnessService', () => {
  let tmpDir: string
  let storage: Storage
  let docker: DockerService
  let audit: AuditService
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-harness-'))
    storage = new Storage(tmpDir)
    docker = new DockerService()
    audit = new AuditService(storage)
    service = new HarnessService(storage, docker, audit)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty list when no config exists', () => {
    expect(service.list()).toEqual([])
  })

  it('stores and retrieves harness config', () => {
    storage.write('harnesses.json', [
      { id: 'h_test', name: 'test-harness', runtime: 'hermes', status: 'stopped', health: { errors: 0 }, persona: 'Test bot', tier: 'individual', platform: 'mattermost', channel: 'test', lastSeen: 0, models: ['claude-haiku-4.5'], costToday: 0, invocations: 0, cpu: 0, mem: 0, tools: [] },
    ])
    const result = service.list()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('test-harness')
  })

  it('gets a single harness by id', () => {
    storage.write('harnesses.json', [
      { id: 'h_test', name: 'test', runtime: 'hermes', status: 'running', health: { errors: 0 }, persona: 'Test', tier: 'team', platform: 'telegram', channel: '@test', lastSeen: Date.now(), models: ['claude-sonnet-4.5'], costToday: 1.5, invocations: 42, cpu: 10, mem: 256, tools: ['memory'] },
    ])
    const harness = service.get('h_test')
    expect(harness).toBeDefined()
    expect(harness!.name).toBe('test')
  })

  it('returns undefined for unknown id', () => {
    storage.write('harnesses.json', [])
    expect(service.get('h_unknown')).toBeUndefined()
  })

  it('updates harness config', () => {
    storage.write('harnesses.json', [
      { id: 'h_test', name: 'test', runtime: 'hermes', status: 'running', health: { errors: 0 }, persona: 'Old', tier: 'individual', platform: 'mattermost', channel: 'test', lastSeen: 0, models: [], costToday: 0, invocations: 0, cpu: 0, mem: 0, tools: [] },
    ])
    service.updateConfig('h_test', { persona: 'New persona', tier: 'team' })
    const updated = service.get('h_test')
    expect(updated!.persona).toBe('New persona')
    expect(updated!.tier).toBe('team')
  })
})
