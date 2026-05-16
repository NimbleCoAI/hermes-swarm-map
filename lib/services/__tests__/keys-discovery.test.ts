// @vitest-environment node
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-keys2-'))
    const storage = new Storage(tmpDir)
    const audit = new AuditService(storage)
    keys = new KeysService(storage, audit)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('adds a manual key and masks the value', () => {
    const key = keys.add({ provider: 'anthropic', value: 'sk-ant-12345678' })
    expect(key.maskedValue).toBe('sk-a…5678')
    expect(key.health).toBe('good')
  })

  it('lists manual keys without raw values', () => {
    keys.add({ provider: 'test', value: 'secret-token-value-here' })
    const list = keys.list([])
    expect(list.length).toBeGreaterThanOrEqual(1)
    // The raw value must never appear
    const serialized = JSON.stringify(list)
    expect(serialized).not.toContain('secret-token-value-here')
  })

  it('removes a manual key', () => {
    const key = keys.add({ provider: 'removeme', value: 'remove-this-key' })
    const removed = keys.remove(key.id)
    expect(removed).toBe(true)
  })
})
