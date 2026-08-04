import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { execFileSync } from 'child_process'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  runDbSnapshotSweep,
  SNAPSHOT_PYTHON,
  type SnapshotTarget,
} from '@/lib/services/db-snapshot'

let root: string

function makeTarget(name: string, opts?: { migrated?: boolean; live?: boolean }): SnapshotTarget {
  const dataDir = path.join(root, name)
  fs.mkdirSync(dataDir, { recursive: true })
  if (opts?.migrated) fs.symlinkSync('/state/state.db', path.join(dataDir, 'state.db'))
  if (opts?.live) fs.writeFileSync(path.join(dataDir, 'state.db'), 'live db bytes')
  return { harnessId: `h_${name}`, name, dataDir, containerName: `hermes-${name}` }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-db-snapshot-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('runDbSnapshotSweep', () => {
  it('execs the python backup only for migrated harnesses; skips live and fresh ones', async () => {
    const migrated = makeTarget('mig', { migrated: true })
    const live = makeTarget('live', { live: true })
    const fresh = makeTarget('fresh')
    const exec = vi.fn().mockResolvedValue('')

    const results = await runDbSnapshotSweep([migrated, live, fresh], exec, 0)

    expect(exec).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledWith('hermes-mig', ['python3', '-c', SNAPSHOT_PYTHON], expect.any(Number))
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ['mig', 'ok'],
      ['live', 'skipped'],
      ['fresh', 'skipped'],
    ])
  })

  it('a migrated harness with a snapshot already exported is still refreshed', async () => {
    const t = makeTarget('mig', { migrated: true })
    fs.writeFileSync(path.join(t.dataDir, 'state.db.snapshot'), 'previous export')
    const exec = vi.fn().mockResolvedValue('')
    const results = await runDbSnapshotSweep([t], exec, 0)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(results[0].status).toBe('ok')
  })

  it('one failing container does not stop the sweep (logged, reported, not thrown)', async () => {
    const down = makeTarget('down', { migrated: true })
    const up = makeTarget('up', { migrated: true })
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error('Error response from daemon: container hermes-down is not running'))
      .mockResolvedValueOnce('')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const results = await runDbSnapshotSweep([down, up], exec, 0)
      expect(results[0].status).toBe('error')
      expect(results[0].detail).toContain('is not running')
      expect(results[1].status).toBe('ok')
      expect(spy).toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })

  it('the export program is atomic (tmp + os.replace) and tolerates a missing DB', () => {
    // Textual contract pin, docker-free: a refactor can't silently drop
    // atomicity, the fresh-harness early-exit, or the torn-tmp self-heal.
    expect(SNAPSHOT_PYTHON).toContain('.snapshot.tmp')
    expect(SNAPSHOT_PYTHON).toContain('os.replace(')
    expect(SNAPSHOT_PYTHON).toContain('src.backup(dst)')
    expect(SNAPSHOT_PYTHON).toContain('sys.exit(0)')
    expect(SNAPSHOT_PYTHON).toContain('mode=ro')
    expect(SNAPSHOT_PYTHON).toContain('os.remove(t)')
  })

  it("maps the program's 'no-db' sentinel to skipped — an aging snapshot must not report ok", async () => {
    const t = makeTarget('mig', { migrated: true })
    const exec = vi.fn().mockResolvedValue('no-db\n')
    const results = await runDbSnapshotSweep([t], exec, 0)
    expect(results[0].status).toBe('skipped')
    expect(results[0].detail).toContain('no db in container yet')
  })

  it('re-entrant sweep returns [] while one is already running (no overlapping backups into one tmp)', async () => {
    const t = makeTarget('mig', { migrated: true })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const exec = vi.fn().mockImplementation(async () => { await gate; return '' })
    const first = runDbSnapshotSweep([t], exec, 0)
    const second = await runDbSnapshotSweep([t], exec, 0) // while first is mid-exec
    expect(second).toEqual([])
    expect(exec).toHaveBeenCalledTimes(1)
    release()
    const firstResults = await first
    expect(firstResults[0].status).toBe('ok')
  })
})

// Run the REAL export program (the exact string exec'd in-container) under a
// local python3, against a real WAL-mode DB with a live writer holding pages
// in the -wal. Skipped where python3 isn't installed.
const python3 = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

describe.skipIf(!python3)('SNAPSHOT_PYTHON under a real python3', () => {
  it('exports a consistent readable snapshot of a live WAL DB', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-snap-py-'))
    try {
      const dbPath = path.join(dir, 'state.db')
      const db = new Database(dbPath)
      db.pragma('journal_mode = WAL')
      db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
      db.prepare('INSERT INTO sessions VALUES (?)').run('s1')
      // Writer stays OPEN (uncheckpointed WAL) while the backup runs.
      execFileSync('python3', ['-c', SNAPSHOT_PYTHON], {
        env: { ...process.env, SNAPSHOT_DB: dbPath },
        stdio: 'pipe',
      })
      db.close()

      const snap = new Database(`${dbPath}.snapshot`, { readonly: true })
      try {
        const row = snap.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }
        expect(row.n).toBe(1)
      } finally {
        snap.close()
      }
      expect(fs.existsSync(`${dbPath}.snapshot.tmp`)).toBe(false) // atomic: no tmp left
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("exits 0 printing 'no-db' without creating anything when the DB is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-snap-py-'))
    try {
      const out = execFileSync('python3', ['-c', SNAPSHOT_PYTHON], {
        env: { ...process.env, SNAPSHOT_DB: path.join(dir, 'state.db') },
        stdio: 'pipe',
      }).toString()
      expect(out.trim()).toBe('no-db')
      expect(fs.readdirSync(dir)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('self-heals a torn .snapshot.tmp left by a crashed export (regression: wedged pipeline)', () => {
    // A previous export died mid-write, leaving a tmp with an invalid SQLite
    // header. Pre-fix, sqlite3.connect+backup against that garbage failed with
    // "file is not a database" on EVERY subsequent cycle — the snapshot aged
    // forever while usage/budget served ever-staler numbers.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-snap-py-'))
    try {
      const dbPath = path.join(dir, 'state.db')
      const db = new Database(dbPath)
      db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
      db.prepare('INSERT INTO sessions VALUES (?)').run('s1')
      db.close()
      fs.writeFileSync(`${dbPath}.snapshot.tmp`, 'torn garbage, not a sqlite header')
      execFileSync('python3', ['-c', SNAPSHOT_PYTHON], {
        env: { ...process.env, SNAPSHOT_DB: dbPath },
        stdio: 'pipe',
      })
      const snap = new Database(`${dbPath}.snapshot`, { readonly: true })
      try {
        const row = snap.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }
        expect(row.n).toBe(1)
      } finally {
        snap.close()
      }
      expect(fs.existsSync(`${dbPath}.snapshot.tmp`)).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
