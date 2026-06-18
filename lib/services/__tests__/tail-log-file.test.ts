// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tailLogFile } from '../harness'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('tailLogFile', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-log-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty string when the file does not exist', () => {
    expect(tailLogFile(path.join(tmpDir, 'nope.log'), 50)).toBe('')
  })

  it('returns empty string for an empty file', () => {
    const p = path.join(tmpDir, 'empty.log')
    fs.writeFileSync(p, '')
    expect(tailLogFile(p, 50)).toBe('')
  })

  it('returns the last N lines', () => {
    const p = path.join(tmpDir, 'g.log')
    const all = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n')
    fs.writeFileSync(p, all + '\n')
    const out = tailLogFile(p, 3)
    expect(out).toBe('line 997\nline 998\nline 999')
  })

  it('returns the whole file when it has fewer lines than requested', () => {
    const p = path.join(tmpDir, 'small.log')
    fs.writeFileSync(p, 'a\nb\nc\n')
    expect(tailLogFile(p, 100)).toBe('a\nb\nc')
  })

  it('does not emit a partial first line when reading a large file from the end', () => {
    const p = path.join(tmpDir, 'big.log')
    // Each line padded large so the byte window starts mid-file.
    const pad = 'x'.repeat(5000)
    const all = Array.from({ length: 2000 }, (_, i) => `L${i}-${pad}`).join('\n')
    fs.writeFileSync(p, all + '\n')
    const out = tailLogFile(p, 5)
    const lines = out.split('\n')
    expect(lines.length).toBe(5)
    // Every returned line must be whole.
    for (const ln of lines) {
      expect(ln.startsWith('L')).toBe(true)
      expect(ln.endsWith(pad)).toBe(true)
    }
    expect(lines[4]).toBe(`L1999-${pad}`)
  })
})
