import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  checkDbAtDir,
  classifyDbError,
  parseLogLineTimestamp,
  runDbPragma,
  runFleetIntegritySweep,
  getIntegrityForHarness,
  getFleetIntegritySnapshot,
  scanLogTextForWriteFailures,
  scanErrorLogForWriteFailures,
  _resetIntegrityStateForTests,
  DB_WRITE_FAILURE_SIGNATURES,
} from '@/lib/services/integrity'

let testRoot: string

function makeDataDir(name: string): string {
  const dir = path.join(testRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function createHealthyDb(dataDir: string): void {
  const db = new Database(path.join(dataDir, 'state.db'))
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, started_at REAL)')
  db.prepare('INSERT INTO sessions VALUES (?, ?)').run('s1', Date.now() / 1000)
  db.close()
}

beforeEach(() => {
  testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-integrity-test-'))
  _resetIntegrityStateForTests()
})

afterEach(() => {
  fs.rmSync(testRoot, { recursive: true, force: true })
})

describe('runDbPragma', () => {
  it('runs quick_check readonly against a healthy DB', () => {
    const dir = makeDataDir('healthy')
    createHealthyDb(dir)
    const rows = runDbPragma(dir, 'quick_check')
    expect(rows).toEqual([{ quick_check: 'ok' }])
  })

  it('throws when the DB file is missing (fileMustExist)', () => {
    const dir = makeDataDir('empty')
    expect(() => runDbPragma(dir, 'quick_check')).toThrow()
  })
})

describe('checkDbAtDir', () => {
  it('reports ok for a healthy DB', () => {
    const dir = makeDataDir('healthy')
    createHealthyDb(dir)
    const result = checkDbAtDir(dir)
    expect(result.status).toBe('ok')
    expect(result.detail).toBeNull()
    expect(result.checkedAt).toBeGreaterThan(0)
  })

  it('reports no-db (not an error) when state.db is missing', () => {
    const dir = makeDataDir('fresh')
    const result = checkDbAtDir(dir)
    expect(result.status).toBe('no-db')
    expect(result.detail).toBeNull()
  })

  it('reports corrupt for a file that is not a SQLite database', () => {
    const dir = makeDataDir('garbage')
    fs.writeFileSync(path.join(dir, 'state.db'), 'this is not a sqlite database at all\n'.repeat(50))
    const result = checkDbAtDir(dir)
    expect(result.status).toBe('corrupt')
    expect(result.detail).toBeTruthy()
  })

  it('reports corrupt for a torn/overwritten page in a real DB', () => {
    const dir = makeDataDir('torn')
    const db = new Database(path.join(dir, 'state.db'))
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, blob TEXT)')
    const insert = db.prepare('INSERT INTO t (blob) VALUES (?)')
    for (let i = 0; i < 200; i++) insert.run('x'.repeat(1000))
    db.close()
    // Overwrite bytes in the middle of the file — mimics the incident's
    // torn page (page-pointer bytes replaced with content bytes).
    const dbPath = path.join(dir, 'state.db')
    const size = fs.statSync(dbPath).size
    const fd = fs.openSync(dbPath, 'r+')
    fs.writeSync(fd, Buffer.from('CORRUPTED PAGE DATA '.repeat(200)), 0, 4000, Math.floor(size / 2))
    fs.closeSync(fd)

    const result = checkDbAtDir(dir)
    expect(result.status).toBe('corrupt')
  })
})

describe('classifyDbError', () => {
  it('maps busy/locked codes to busy', () => {
    expect(classifyDbError({ code: 'SQLITE_BUSY' })).toBe('busy')
    expect(classifyDbError({ code: 'SQLITE_BUSY_SNAPSHOT' })).toBe('busy')
    expect(classifyDbError({ code: 'SQLITE_LOCKED' })).toBe('busy')
  })

  it('maps corruption codes to corrupt', () => {
    expect(classifyDbError({ code: 'SQLITE_CORRUPT' })).toBe('corrupt')
    expect(classifyDbError({ code: 'SQLITE_NOTADB' })).toBe('corrupt')
  })

  it('maps everything else to error', () => {
    expect(classifyDbError({ code: 'SQLITE_CANTOPEN' })).toBe('error')
    expect(classifyDbError(new Error('nope'))).toBe('error')
    expect(classifyDbError(undefined)).toBe('error')
  })
})

describe('runFleetIntegritySweep', () => {
  it('checks each target, caches results, and prunes removed harnesses', async () => {
    const healthy = makeDataDir('sweep-healthy')
    createHealthyDb(healthy)
    const fresh = makeDataDir('sweep-fresh')

    const snapshot = await runFleetIntegritySweep(
      [
        { harnessId: 'h_a', name: 'a', dataDir: healthy },
        { harnessId: 'h_b', name: 'b', dataDir: fresh },
      ],
      0,
    )

    expect(snapshot.lastSweepAt).not.toBeNull()
    expect(snapshot.sweepInProgress).toBe(false)
    expect(getIntegrityForHarness('h_a')?.status).toBe('ok')
    expect(getIntegrityForHarness('h_b')?.status).toBe('no-db')

    // A later sweep without h_b drops its stale entry.
    await runFleetIntegritySweep([{ harnessId: 'h_a', name: 'a', dataDir: healthy }], 0)
    expect(getIntegrityForHarness('h_b')).toBeNull()
    expect(getFleetIntegritySnapshot().results.map((r) => r.harnessId)).toEqual(['h_a'])
  })
})

describe('parseLogLineTimestamp', () => {
  it('parses python-logging timestamps (comma millis)', () => {
    const ts = parseLogLineTimestamp('2026-05-16 02:18:50,965 WARNING gateway: boom')
    expect(ts).toBe(Date.parse('2026-05-16T02:18:50') + 965)
  })

  it('returns null for lines without a leading timestamp', () => {
    expect(parseLogLineTimestamp('Traceback (most recent call last):')).toBeNull()
  })
})

describe('scanLogTextForWriteFailures', () => {
  const fixture = [
    '2026-05-10 08:00:00,100 ERROR agent.db: state.db write failed: database disk image is malformed',
    '2026-05-10 08:00:05,200 WARNING gateway.platforms.mattermost: Mattermost WS error: reconnecting in 60s',
    '2026-05-12 09:30:00,000 ERROR agent.db: append_message failed: database disk image is malformed',
    'Traceback (most recent call last):',
    '2026-05-16 23:59:59,999 ERROR agent.db: append_message failed',
  ].join('\n')

  it('counts matching lines and tracks first/last seen', () => {
    const signal = scanLogTextForWriteFailures(fixture)
    expect(signal.count).toBe(3)
    expect(signal.scannedLines).toBe(5)
    expect(signal.firstSeen).toBe(Date.parse('2026-05-10T08:00:00') + 100)
    expect(signal.lastSeen).toBe(Date.parse('2026-05-16T23:59:59') + 999)
  })

  it('breaks counts down by signature (a line can hit several)', () => {
    const signal = scanLogTextForWriteFailures(fixture)
    expect(signal.bySignature['state.db write failed']).toBe(1)
    expect(signal.bySignature['append_message failed']).toBe(2)
    expect(signal.bySignature['database disk image is malformed']).toBe(2)
  })

  it('returns a zero signal for empty or clean logs', () => {
    expect(scanLogTextForWriteFailures('').count).toBe(0)
    const clean = scanLogTextForWriteFailures('2026-05-16 02:18:50,965 WARNING gateway: fine\n')
    expect(clean.count).toBe(0)
    expect(clean.firstSeen).toBeNull()
  })

  it('matches every incident signature case-insensitively', () => {
    for (const sig of DB_WRITE_FAILURE_SIGNATURES) {
      const signal = scanLogTextForWriteFailures(`2026-05-16 00:00:00,000 ERROR x: ${sig.toUpperCase()}`)
      expect(signal.count).toBe(1)
    }
  })
})

describe('scanErrorLogForWriteFailures', () => {
  it('reads the tail of <dataDir>/logs/errors.log', () => {
    const dir = makeDataDir('with-logs')
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'logs', 'errors.log'),
      '2026-05-16 02:00:00,000 ERROR agent.db: state.db write failed\n',
    )
    const signal = scanErrorLogForWriteFailures(dir)
    expect(signal.count).toBe(1)
  })

  it('returns a zero signal when errors.log is missing', () => {
    const dir = makeDataDir('no-logs')
    const signal = scanErrorLogForWriteFailures(dir)
    expect(signal.count).toBe(0)
    expect(signal.scannedLines).toBe(0)
  })

  it('only scans the requested tail window', () => {
    const dir = makeDataDir('long-log')
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
    const oldFailure = '2026-05-01 00:00:00,000 ERROR agent.db: state.db write failed\n'
    const noise = '2026-05-16 02:00:00,000 WARNING gateway: fine\n'.repeat(600)
    fs.writeFileSync(path.join(dir, 'logs', 'errors.log'), oldFailure + noise)
    // The failure line has scrolled out of the 500-line window.
    const signal = scanErrorLogForWriteFailures(dir)
    expect(signal.count).toBe(0)
    expect(signal.scannedLines).toBe(500)
  })
})
