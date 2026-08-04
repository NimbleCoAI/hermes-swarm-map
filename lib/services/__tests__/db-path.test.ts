import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { resolveStateDbPath, isStateDbMigrated } from '@/lib/services/db-path'

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-db-path-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('resolveStateDbPath', () => {
  it('none: fresh harness with no state.db', () => {
    expect(resolveStateDbPath(dir)).toEqual({ kind: 'none' })
    expect(isStateDbMigrated(dir)).toBe(false)
  })

  it('live: a regular state.db file (unmigrated)', () => {
    const p = path.join(dir, 'state.db')
    fs.writeFileSync(p, 'db-bytes')
    expect(resolveStateDbPath(dir)).toEqual({ kind: 'live', path: p })
    expect(isStateDbMigrated(dir)).toBe(false)
  })

  it('migrated-pending: dangling symlink, no snapshot yet — NOT none', () => {
    // The migrated symlink's target (/state/state.db) exists only in-container;
    // from the host it is dangling, and existsSync would lie (false).
    fs.symlinkSync('/state/state.db', path.join(dir, 'state.db'))
    expect(resolveStateDbPath(dir)).toEqual({ kind: 'migrated-pending' })
    expect(isStateDbMigrated(dir)).toBe(true)
  })

  it('snapshot: symlink plus an exported state.db.snapshot', () => {
    fs.symlinkSync('/state/state.db', path.join(dir, 'state.db'))
    const snap = path.join(dir, 'state.db.snapshot')
    fs.writeFileSync(snap, 'snapshot-bytes')
    expect(resolveStateDbPath(dir)).toEqual({ kind: 'snapshot', path: snap })
    expect(isStateDbMigrated(dir)).toBe(true)
  })

  it('a snapshot file WITHOUT a symlink does not shadow the live DB', () => {
    // De-migrated (rollback) harness may still have a stale snapshot around;
    // the regular file is authoritative.
    const p = path.join(dir, 'state.db')
    fs.writeFileSync(p, 'db-bytes')
    fs.writeFileSync(path.join(dir, 'state.db.snapshot'), 'old snapshot')
    expect(resolveStateDbPath(dir)).toEqual({ kind: 'live', path: p })
  })
})
