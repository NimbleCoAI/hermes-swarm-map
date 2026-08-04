import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  checkDb,
  classifyDbError,
  parseLogLineTimestamp,
  runDbPragma,
  runFleetIntegritySweep,
  getIntegrityForHarness,
  getFleetIntegritySnapshot,
  scanLogTextForWriteFailures,
  scanErrorLogForWriteFailures,
  _resetIntegrityStateForTests,
  _setExecTransportForTests,
  DB_WRITE_FAILURE_SIGNATURES,
  type DbCheckTarget,
} from '@/lib/services/integrity'

let testRoot: string

function makeDataDir(name: string): string {
  const dir = path.join(testRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** Host-transport target (regular file / missing file). */
function targetFor(dir: string): DbCheckTarget {
  return { dataDir: dir, containerName: 'hermes-test' }
}

function createHealthyDb(dataDir: string): void {
  const db = new Database(path.join(dataDir, 'state.db'))
  // Production DBs run WAL mode — better-sqlite3's default is delete-journal,
  // which never exercises the mode the fleet actually runs in.
  db.pragma('journal_mode = WAL')
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
  it('runs quick_check readonly against a healthy DB', async () => {
    const dir = makeDataDir('healthy')
    createHealthyDb(dir)
    const rows = await runDbPragma(targetFor(dir), 'quick_check')
    expect(rows).toEqual([{ quick_check: 'ok' }])
  })

  it('throws when the DB file is missing (fileMustExist)', async () => {
    const dir = makeDataDir('empty')
    await expect(runDbPragma(targetFor(dir), 'quick_check')).rejects.toThrow()
  })
})

describe('checkDb (host transport: regular file)', () => {
  it('reports ok for a healthy DB', async () => {
    const dir = makeDataDir('healthy')
    createHealthyDb(dir)
    const result = await checkDb(targetFor(dir))
    expect(result.status).toBe('ok')
    expect(result.detail).toBeNull()
    expect(result.checkedAt).toBeGreaterThan(0)
  })

  it('reports no-db (not an error) when state.db is missing', async () => {
    const dir = makeDataDir('fresh')
    const result = await checkDb(targetFor(dir))
    expect(result.status).toBe('no-db')
    expect(result.detail).toBeNull()
  })

  it('reports corrupt for a file that is not a SQLite database', async () => {
    const dir = makeDataDir('garbage')
    fs.writeFileSync(path.join(dir, 'state.db'), 'this is not a sqlite database at all\n'.repeat(50))
    const result = await checkDb(targetFor(dir))
    expect(result.status).toBe('corrupt')
    expect(result.detail).toBeTruthy()
  })

  it('reports corrupt for a torn/overwritten page in a real WAL-mode DB', async () => {
    const dir = makeDataDir('torn')
    const db = new Database(path.join(dir, 'state.db'))
    db.pragma('journal_mode = WAL')
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

    const result = await checkDb(targetFor(dir))
    expect(result.status).toBe('corrupt')
  })

  it('classifies a REAL lock as busy (second connection holds an exclusive txn)', async () => {
    // Not a fabricated {code} object: an actual writer connection holds an
    // exclusive lock while checkDb tries to read. Uses rollback-journal
    // mode because WAL readers are never blocked by writers — an exclusive
    // rollback-mode txn is the way to produce a genuine SQLITE_BUSY.
    // A regular file always takes the sync/host branch, so this still
    // exercises the PR1 path post-transport-swap.
    // NOTE: live cross-VM WAL contention (host reader vs container writer
    // through VirtioFS) is NOT reproducible in unit tests — see the KNOWN GAP
    // note in integrity.ts; this test covers the in-process lock path only.
    const dir = makeDataDir('locked')
    const writer = new Database(path.join(dir, 'state.db'))
    writer.pragma('journal_mode = DELETE')
    writer.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)')
    writer.exec('BEGIN EXCLUSIVE')
    try {
      const result = await checkDb(targetFor(dir))
      expect(result.status).toBe('busy')
    } finally {
      writer.exec('ROLLBACK')
      writer.close()
    }
  }, 15000)
})

describe('checkDb (exec transport: migrated symlink)', () => {
  function makeMigratedDir(name: string): string {
    const dir = makeDataDir(name)
    // Host view of a migrated harness: dangling symlink into the container.
    fs.symlinkSync('/state/state.db', path.join(dir, 'state.db'))
    return dir
  }

  it('routes to docker exec and reports ok on a clean quick_check', async () => {
    const dir = makeMigratedDir('mig-ok')
    const exec = vi.fn().mockResolvedValue('ok\n')
    _setExecTransportForTests(exec)
    const result = await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    expect(result.status).toBe('ok')
    expect(exec).toHaveBeenCalledTimes(1)
    const [container, argv] = exec.mock.calls[0]
    expect(container).toBe('hermes-mig')
    expect(argv[0]).toBe('python3')
    expect(argv[2]).toContain('PRAGMA quick_check')
  })

  it('maps quick_check findings to corrupt (hysteresis input intact)', async () => {
    const dir = makeMigratedDir('mig-corrupt')
    _setExecTransportForTests(async () => 'row 17 missing from index i1\nwrong # of entries in index i1\n')
    const result = await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    expect(result.status).toBe('corrupt')
    expect(result.detail).toContain('row 17 missing')
  })

  it('maps "database is locked" to busy across the transport', async () => {
    const dir = makeMigratedDir('mig-busy')
    _setExecTransportForTests(async () => {
      throw Object.assign(new Error('Command failed'), { stderr: 'database is locked' })
    })
    const result = await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    expect(result.status).toBe('busy')
  })

  it('maps "malformed" exec errors to corrupt', async () => {
    const dir = makeMigratedDir('mig-malformed')
    _setExecTransportForTests(async () => {
      throw Object.assign(new Error('Command failed'), { stderr: 'database disk image is malformed' })
    })
    const result = await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    expect(result.status).toBe('corrupt')
  })

  it('reports no-db (NOT error) for a fresh migrated harness whose DB has no first write yet', async () => {
    // Regression (#204 PR2 review): the symlink dangles in-container until the
    // agent's first DB write. pragmaPython exits EXEC_NO_DB_EXIT_CODE for that
    // (execFileAsync surfaces it as err.code = 4); mapping it through
    // SQLITE_CANTOPEN would put a red 'error' badge on every new/idle harness,
    // training operators to ignore the badge.
    const dir = makeMigratedDir('mig-fresh')
    _setExecTransportForTests(async () => {
      throw Object.assign(new Error('Command failed: docker exec …'), { code: 4 })
    })
    const result = await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    expect(result.status).toBe('no-db')
    expect(result.detail).toBeNull()
  })

  it('the exec pragma program guards the missing-db case before connecting', async () => {
    const dir = makeMigratedDir('mig-prog')
    const exec = vi.fn().mockResolvedValue('ok\n')
    _setExecTransportForTests(exec)
    await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    const program = exec.mock.calls[0][1][2] as string
    expect(program).toContain('os.path.exists')
    expect(program).toContain('sys.exit(4)')
  })

  it('reports error (NOT no-db) when the container is down', async () => {
    const dir = makeMigratedDir('mig-down')
    _setExecTransportForTests(async () => {
      throw new Error('Error response from daemon: container hermes-mig is not running')
    })
    const result = await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    expect(result.status).toBe('error')
    expect(result.detail).toContain('container not running')
  })

  it('never opens the host path for a symlinked DB (no better-sqlite3 CANTOPEN)', async () => {
    // If checkDb fell through to better-sqlite3, the dangling link would
    // produce SQLITE_CANTOPEN ('error'); the exec transport must win instead.
    const dir = makeMigratedDir('mig-transport')
    const exec = vi.fn().mockResolvedValue('ok\n')
    _setExecTransportForTests(exec)
    await checkDb({ dataDir: dir, containerName: 'hermes-mig' })
    expect(exec).toHaveBeenCalled()
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
        { harnessId: 'h_a', name: 'a', dataDir: healthy, containerName: 'hermes-a' },
        { harnessId: 'h_b', name: 'b', dataDir: fresh, containerName: 'hermes-b' },
      ],
      0,
    )

    expect(snapshot.lastSweepAt).not.toBeNull()
    expect(snapshot.sweepInProgress).toBe(false)
    expect(getIntegrityForHarness('h_a')?.status).toBe('ok')
    expect(getIntegrityForHarness('h_b')?.status).toBe('no-db')

    // A later sweep without h_b drops its stale entry.
    await runFleetIntegritySweep([{ harnessId: 'h_a', name: 'a', dataDir: healthy, containerName: 'hermes-a' }], 0)
    expect(getIntegrityForHarness('h_b')).toBeNull()
    expect(getFleetIntegritySnapshot().results.map((r) => r.harnessId)).toEqual(['h_a'])
  })
})

describe('corruption hysteresis', () => {
  // Pass a long recheck delay so the internal timer never fires mid-test;
  // confirmation comes from explicit second sweeps instead.
  const RECHECK_NEVER = 60 * 60 * 1000

  function createCorruptDb(dirName: string): string {
    const dir = makeDataDir(dirName)
    fs.writeFileSync(path.join(dir, 'state.db'), 'not a sqlite database\n'.repeat(50))
    return dir
  }

  it('publishes recheck-pending (not corrupt) on the FIRST corrupt sample', async () => {
    const dir = createCorruptDb('hys-first')
    await runFleetIntegritySweep([{ harnessId: 'h_c', name: 'c', dataDir: dir, containerName: 'hermes-c' }], 0, RECHECK_NEVER)
    expect(getIntegrityForHarness('h_c')?.status).toBe('recheck-pending')
  })

  it('confirms corrupt on the SECOND consecutive corrupt sample', async () => {
    const dir = createCorruptDb('hys-second')
    const targets = [{ harnessId: 'h_c', name: 'c', dataDir: dir, containerName: 'hermes-c' }]
    await runFleetIntegritySweep(targets, 0, RECHECK_NEVER)
    await runFleetIntegritySweep(targets, 0, RECHECK_NEVER)
    expect(getIntegrityForHarness('h_c')?.status).toBe('corrupt')
  })

  it('clears the pending state when a later sample is healthy (torn-read scenario)', async () => {
    const dir = createCorruptDb('hys-clears')
    const targets = [{ harnessId: 'h_c', name: 'c', dataDir: dir, containerName: 'hermes-c' }]
    await runFleetIntegritySweep(targets, 0, RECHECK_NEVER)
    expect(getIntegrityForHarness('h_c')?.status).toBe('recheck-pending')

    // The "corruption" was transient (e.g. a torn read of a live WAL DB):
    // replace with a healthy DB before the second sample.
    fs.rmSync(path.join(dir, 'state.db'))
    createHealthyDb(dir)
    await runFleetIntegritySweep(targets, 0, RECHECK_NEVER)
    expect(getIntegrityForHarness('h_c')?.status).toBe('ok')

    // And a NEW corrupt sample after clearing starts the cycle over —
    // recheck-pending again, not instant corrupt.
    fs.writeFileSync(path.join(dir, 'state.db'), 'garbage again\n'.repeat(50))
    await runFleetIntegritySweep(targets, 0, RECHECK_NEVER)
    expect(getIntegrityForHarness('h_c')?.status).toBe('recheck-pending')
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

  it('ignores signature mentions outside WARNING/ERROR/CRITICAL lines', () => {
    // Recovery chatter and traceback frames may MENTION the signature strings;
    // only leveled warning/error lines count.
    const text = [
      '2026-05-16 02:00:00,000 INFO agent.db: recovered from: database disk image is malformed',
      '    raise DatabaseError("database disk image is malformed")',
      '2026-05-16 02:00:01,000 DEBUG agent.db: retrying append_message failed batch',
    ].join('\n')
    expect(scanLogTextForWriteFailures(text).count).toBe(0)
  })

  it('marks the signal recent only when lastSeen is inside the alert window', () => {
    const line = '2026-05-16 02:00:00,000 ERROR agent.db: state.db write failed'
    const lastSeen = Date.parse('2026-05-16T02:00:00')
    const hour = 60 * 60 * 1000

    const fresh = scanLogTextForWriteFailures(line, {
      now: lastSeen + hour,
      alertWindowMs: 24 * hour,
    })
    expect(fresh.recent).toBe(true)

    const stale = scanLogTextForWriteFailures(line, {
      now: lastSeen + 25 * hour,
      alertWindowMs: 24 * hour,
    })
    expect(stale.count).toBe(1) // still counted…
    expect(stale.recent).toBe(false) // …but not alert-red
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

  it('falls back to errors.log.1 when errors.log is freshly rotated', () => {
    const dir = makeDataDir('rotated')
    fs.mkdirSync(path.join(dir, 'logs'), { recursive: true })
    // Rotation just happened: current log is nearly empty, the failure
    // evidence lives in errors.log.1.
    fs.writeFileSync(
      path.join(dir, 'logs', 'errors.log'),
      '2026-05-16 03:00:00,000 WARNING gateway: fine\n',
    )
    fs.writeFileSync(
      path.join(dir, 'logs', 'errors.log.1'),
      '2026-05-16 02:00:00,000 ERROR agent.db: append_message failed\n',
    )
    const signal = scanErrorLogForWriteFailures(dir)
    expect(signal.count).toBe(1)
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
