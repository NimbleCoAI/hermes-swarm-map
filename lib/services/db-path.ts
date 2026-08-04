/**
 * Host-side state.db path resolution for named-volume-migrated harnesses
 * (#204 PR2).
 *
 * After migration, `<dataDir>/state.db` on the HOST is a symlink whose target
 * (/state/state.db) only exists inside the container — i.e. a dangling symlink
 * from the host's point of view. `fs.existsSync` follows symlinks and returns
 * FALSE for it, so every reader gated on existsSync silently reported
 * no-db/zero the moment a harness migrated (usage → $0, budget enforcement
 * silently OFF, integrity → 'no-db'). This module is the one place that
 * classifies the four possible states via lstat, so callers can branch
 * explicitly instead of misreading the dangling link.
 *
 * Migrated harnesses are read through `state.db.snapshot` — a consistent copy
 * exported into /opt/data (host-visible via the bind mount) by the snapshot
 * scheduler (db-snapshot.ts), at most SNAPSHOT interval (default 5 min) stale.
 */
import fs from 'fs'
import path from 'path'

export type StateDbResolution =
  /** Regular file — unmigrated harness; read it directly. */
  | { kind: 'live'; path: string }
  /** Migrated (symlink) AND a snapshot export exists — read the snapshot. */
  | { kind: 'snapshot'; path: string }
  /**
   * Migrated (symlink) but no snapshot exported yet — the window between the
   * init service running and the first snapshot sweep. Data exists but is
   * UNREADABLE from the host: callers must surface "unknown", never zero.
   */
  | { kind: 'migrated-pending' }
  /** No state.db at all — fresh harness. */
  | { kind: 'none' }

export function resolveStateDbPath(dataDir: string): StateDbResolution {
  const dbPath = path.join(dataDir, 'state.db')
  let st: fs.Stats
  try {
    // lstat, NOT stat/existsSync: those follow the (host-dangling) symlink.
    st = fs.lstatSync(dbPath)
  } catch {
    return { kind: 'none' }
  }
  if (st.isSymbolicLink()) {
    const snap = path.join(dataDir, 'state.db.snapshot')
    return fs.existsSync(snap) ? { kind: 'snapshot', path: snap } : { kind: 'migrated-pending' }
  }
  return { kind: 'live', path: dbPath }
}

/** True when the harness's state.db has been migrated to the named volume. */
export function isStateDbMigrated(dataDir: string): boolean {
  const r = resolveStateDbPath(dataDir)
  return r.kind === 'snapshot' || r.kind === 'migrated-pending'
}
