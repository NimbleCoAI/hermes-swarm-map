import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KeysService } from '../keys'
import { Storage } from '../storage'
import { AuditService } from '../audit'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('KeysService', () => {
  let tmpDir: string
  let keys: KeysService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-keys-'))
    const storage = new Storage(tmpDir)
    const audit = new AuditService(storage)
    keys = new KeysService(storage, audit)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // Pass [] as harnessNames so discovery is skipped (no real agent dirs in test env)
  it('starts with empty list', () => {
    expect(keys.list([])).toEqual([])
  })

  it('adds a key and masks the value', () => {
    const key = keys.add({ provider: 'anthropic', value: 'sk-ant-12345678' })
    expect(key.provider).toBe('anthropic')
    expect(key.maskedValue).toBe('sk-a…5678')
    expect(key.health).toBe('good')
  })

  it('lists keys with masked values', () => {
    keys.add({ provider: 'anthropic', value: 'sk-ant-12345678' })
    keys.add({ provider: 'openai', value: 'sk-proj-abcdefgh' })
    const list = keys.list([])
    expect(list).toHaveLength(2)
    expect(JSON.stringify(list)).not.toContain('sk-ant-12345678')
    expect(JSON.stringify(list)).not.toContain('sk-proj-abcdefgh')
  })

  it('removes a key', () => {
    const key = keys.add({ provider: 'test', value: 'test-key-value' })
    keys.remove(key.id)
    expect(keys.list([])).toHaveLength(0)
  })

  it('updates key assignment', () => {
    const key = keys.add({ provider: 'test', value: 'test-key' })
    keys.update(key.id, { assignedTo: ['h_audrey', 'h_cryptid'] })
    const updated = keys.list([]).find((k) => k.id === key.id)
    expect(updated!.assignedTo).toEqual(['h_audrey', 'h_cryptid'])
  })
})
