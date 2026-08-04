/**
 * Server-side scheduler for the state.db snapshot export (#204 PR2).
 *
 * Same shape as integrity-scheduler.ts: HSM has no job runner — a plain
 * unref'd setInterval registered from instrumentation.ts is the whole
 * scheduler. Default every 5 minutes (DB_SNAPSHOT_INTERVAL_MS overrides);
 * snapshot staleness is bounded by this interval, which is what the usage /
 * budget readers document as their freshness bound.
 */

import { runDbSnapshotSweep } from './db-snapshot'

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000 // 5 min
// Offset from the integrity scheduler's 30s so the two sweeps don't pile up
// on the same boot tick.
const INITIAL_DELAY_MS = 45 * 1000

export async function runScheduledSnapshotSweep(): Promise<void> {
  try {
    await runDbSnapshotSweep()
  } catch (err) {
    // A failed sweep must never take the server down; a stale snapshot beats a crash.
    console.error('[db-snapshot] fleet sweep failed:', err)
  }
}

// Survives dev/HMR module re-evaluation — the flag lives on globalThis, not in
// module scope, so a re-imported module can't double-register timers.
declare global {
  var __hsmDbSnapshotSchedulerStarted: boolean | undefined
}

export function startDbSnapshotScheduler(): void {
  if (globalThis.__hsmDbSnapshotSchedulerStarted) return
  globalThis.__hsmDbSnapshotSchedulerStarted = true

  const envInterval = parseInt(process.env.DB_SNAPSHOT_INTERVAL_MS ?? '', 10)
  const intervalMs = Number.isFinite(envInterval) && envInterval > 0 ? envInterval : DEFAULT_INTERVAL_MS

  const initial = setTimeout(() => void runScheduledSnapshotSweep(), INITIAL_DELAY_MS)
  initial.unref?.()
  const recurring = setInterval(() => void runScheduledSnapshotSweep(), intervalMs)
  recurring.unref?.()
}
