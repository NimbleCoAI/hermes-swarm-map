import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AuditService } from '../audit'
import { Storage } from '../storage'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('AuditService', () => {
  let tmpDir: string
  let audit: AuditService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-audit-'))
    const storage = new Storage(tmpDir)
    audit = new AuditService(storage)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('appends and queries entries', () => {
    audit.append({ who: 'admin', what: 'restart', target: 'audrey' })
    audit.append({ who: 'admin', what: 'stop', target: 'cryptid' })
    const all = audit.query({})
    expect(all).toHaveLength(2)
    expect(all[0].what).toBe('stop')
    expect(all[1].what).toBe('restart')
  })

  it('filters by who', () => {
    audit.append({ who: 'admin', what: 'restart', target: 'audrey' })
    audit.append({ who: 'system', what: 'error', target: 'frontdesk' })
    const filtered = audit.query({ who: 'admin' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].who).toBe('admin')
  })

  it('filters by what', () => {
    audit.append({ who: 'admin', what: 'restart', target: 'audrey' })
    audit.append({ who: 'admin', what: 'stop', target: 'cryptid' })
    const filtered = audit.query({ what: 'restart' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].target).toBe('audrey')
  })

  it('returns empty array when no entries', () => {
    const result = audit.query({})
    expect(result).toEqual([])
  })
})
