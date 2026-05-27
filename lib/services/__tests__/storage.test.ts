import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Storage } from '../storage'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('Storage', () => {
  let tmpDir: string
  let storage: Storage

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-test-'))
    storage = new Storage(tmpDir)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads a file that does not exist and returns default', () => {
    const result = storage.read<{ items: string[] }>('missing.json', { items: [] })
    expect(result).toEqual({ items: [] })
  })

  it('writes and reads back JSON', () => {
    storage.write('test.json', { name: 'hello', count: 42 })
    const result = storage.read<{ name: string; count: number }>('test.json', { name: '', count: 0 })
    expect(result).toEqual({ name: 'hello', count: 42 })
  })

  it('creates nested directories on write', () => {
    storage.write('sub/dir/data.json', { ok: true })
    const result = storage.read<{ ok: boolean }>('sub/dir/data.json', { ok: false })
    expect(result).toEqual({ ok: true })
  })

  it('appends a line to a JSONL file', () => {
    storage.appendLine('log.jsonl', { ts: 1, msg: 'first' })
    storage.appendLine('log.jsonl', { ts: 2, msg: 'second' })
    const lines = storage.readLines<{ ts: number; msg: string }>('log.jsonl')
    expect(lines).toEqual([
      { ts: 1, msg: 'first' },
      { ts: 2, msg: 'second' },
    ])
  })

  it('readLines returns empty array for missing file', () => {
    const lines = storage.readLines('missing.jsonl')
    expect(lines).toEqual([])
  })
})
