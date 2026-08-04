/**
 * Fleet-wide SQLite integrity monitoring (#204, PR1).
 *
 * Harness state DBs live on the host (VirtioFS bind mounts) and can be torn
 * by mid-write hard-stops under Docker Desktop VM memory pressure. In the
 * motivating incident a harness's state.db failed writes for 6 days with no
 * surfaced signal. This module provides:
 *
 *   - a readonly `PRAGMA quick_check` per harness, behind a small transport
 *     seam (`runDbPragma`) so PR2 can swap host-path access for docker-exec
 *     once DBs migrate to named volumes;
 *   - an in-memory result cache (restart-tracker style) filled by a
 *     staggered fleet sweep, driven from instrumentation.ts;
 *   - a write-failure signal scanned from the tail of each harness's
 *     host-visible errors.log.
 *
 * better-sqlite3 is synchronous, so a quick_check blocks the event loop for
 * its duration. The sweep therefore checks one harness at a time and yields
 * (setTimeout) between harnesses instead of fanning out.
 *
 * KNOWN GAP (acknowledged, not unit-testable here): the host-side readonly
 * reader shares the DB with a WAL-mode writer that lives across a VM/VirtioFS
 * boundary. Live cross-VM WAL contention cannot be reproduced in unit tests —
 * it needs Docker Desktop's file-sharing translation layer under real write
 * load. That is exactly why (a) a single non-ok quick_check is never trusted
 * (see corruption hysteresis below), and (b) this host-path transport is
 * interim until PR2 swaps `runDbPragma` to a docker-exec transport inside the
 * VM, where SQLite's locking assumptions actually hold.
 */

import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { agentDataDirForName, tailLogFile } from './harness'

export type DbIntegrityStatus =
  | 'ok'
  | 'no-db'
  | 'busy'
  | 'corrupt'
  // Non-ok quick_check seen once, not yet confirmed by a second sample.
  | 'recheck-pending'
  | 'error'

export type DbIntegrityResult = {
  status: DbIntegrityStatus
  /** quick_check findings / error message when status is not ok (truncated). */
  detail: string | null
  checkedAt: number
  durationMs: number
}

export type FleetIntegrityEntry = DbIntegrityResult & {
  harnessId: string
  name: string
}

export type FleetIntegritySnapshot = {
  lastSweepAt: number | null
  sweepInProgress: boolean
  results: FleetIntegrityEntry[]
}

export type DbWriteFailureSignal = {
  /** Matching WARNING/ERROR/CRITICAL lines in the scanned tail window. */
  count: number
  /** Epoch ms of the earliest/latest matching line, when parseable. */
  firstSeen: number | null
  lastSeen: number | null
  /**
   * True when lastSeen falls inside the alert window (default 24h,
   * DB_WRITE_FAILURE_ALERT_WINDOW_MS overrides). Old matches on an idle
   * agent — or matches with unparseable timestamps — degrade to a warning
   * instead of latching a red badge forever.
   */
  recent: boolean
  bySignature: Record<string, number>
  scannedLines: number
}

// Error-log signatures from the real corruption incident: the agent kept
// running while every DB write failed, and these were the only trace.
export const DB_WRITE_FAILURE_SIGNATURES = [
  'database disk image is malformed',
  'state.db write failed',
  'append_message failed',
] as const

const DEFAULT_SCAN_LINES = 500
const DETAIL_MAX_CHARS = 500

const DEFAULT_WRITE_FAILURE_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h

function writeFailureAlertWindowMs(): number {
  const env = parseInt(process.env.DB_WRITE_FAILURE_ALERT_WINDOW_MS ?? '', 10)
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_WRITE_FAILURE_ALERT_WINDOW_MS
}

// name-keyed like usage.ts: h_foo_bar → foo-bar → ~/.hermes-foo-bar
function harnessIdToName(harnessId: string): string {
  return harnessId.replace(/^h_/, '').replace(/_/g, '-')
}

function dataDirForHarnessId(harnessId: string): string {
  return agentDataDirForName(harnessIdToName(harnessId))
}

// --- Transport seam (PR2) ---------------------------------------------------
// All SQLite access for integrity checks goes through this one function.
// Today it opens the host-visible DB file readonly; after the named-volume
// migration (PR2) this becomes a docker-exec into the container, with the
// same signature.
export function runDbPragma(dataDir: string, sql: string): unknown[] {
  const dbPath = path.join(dataDir, 'state.db')
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    // Don't fail instantly on a transiently locked DB; a couple of seconds
    // is plenty for WAL readers.
    db.pragma('busy_timeout = 2000')
    const rows = db.pragma(sql)
    return Array.isArray(rows) ? rows : [rows]
  } finally {
    db.close()
  }
}

/** Map a better-sqlite3 error to an integrity status. Exported for tests. */
export function classifyDbError(err: unknown): 'busy' | 'corrupt' | 'error' {
  const code = String((err as { code?: unknown })?.code ?? '')
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) return 'busy'
  if (code.startsWith('SQLITE_CORRUPT') || code.startsWith('SQLITE_NOTADB')) return 'corrupt'
  return 'error'
}

/**
 * Run a readonly quick_check against the state.db under dataDir.
 * A missing DB is not an error — fresh harnesses simply have no DB yet.
 *
 * Returns the RAW single-sample verdict; callers must not surface a raw
 * 'corrupt' directly — publish through the corruption-hysteresis gate
 * (applyCheckResult) instead.
 */
export function checkDbAtDir(dataDir: string): DbIntegrityResult {
  const start = Date.now()
  const dbPath = path.join(dataDir, 'state.db')
  if (!fs.existsSync(dbPath)) {
    return { status: 'no-db', detail: null, checkedAt: start, durationMs: 0 }
  }
  try {
    const rows = runDbPragma(dataDir, 'quick_check')
    // quick_check returns a single 'ok' row on a healthy DB, otherwise one
    // row per finding.
    const findings = rows.map((r) =>
      r !== null && typeof r === 'object' ? String(Object.values(r)[0]) : String(r),
    )
    const ok = findings.length === 1 && findings[0] === 'ok'
    return {
      status: ok ? 'ok' : 'corrupt',
      detail: ok ? null : findings.join('; ').slice(0, DETAIL_MAX_CHARS),
      checkedAt: start,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      status: classifyDbError(err),
      detail: msg.slice(0, DETAIL_MAX_CHARS),
      checkedAt: start,
      durationMs: Date.now() - start,
    }
  }
}

// --- Write-failure signal ---------------------------------------------------

// Harness logs use Python logging format: `2026-05-16 02:18:50,965 LEVEL ...`.
// A signature only counts on a real WARNING/ERROR/CRITICAL line — bare
// substring hits (traceback frames, recovery chatter merely mentioning the
// strings) don't count.
const LOG_LINE_RE =
  /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:[,.](\d{3}))?\s+(ERROR|WARNING|CRITICAL)\b/

const LOG_TS_RE = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})(?:[,.](\d{3}))?/

/**
 * Parse the leading timestamp of a log line to epoch ms, if present.
 *
 * Caveat (L1): the log timestamp is naive (no zone). Date.parse treats it as
 * HOST-local time, while the container likely logs in UTC — so firstSeen/
 * lastSeen can be skewed by the host's UTC offset. Acceptable for a
 * recency/staleness signal; do not treat these as exact incident timestamps.
 */
export function parseLogLineTimestamp(line: string): number | null {
  const m = LOG_TS_RE.exec(line)
  if (!m) return null
  const base = Date.parse(m[1].replace(' ', 'T'))
  if (Number.isNaN(base)) return null
  return base + (m[2] ? parseInt(m[2], 10) : 0)
}

/** Scan raw log text for DB-write-failure signatures. Pure; exported for tests. */
export function scanLogTextForWriteFailures(
  text: string,
  opts?: { now?: number; alertWindowMs?: number },
): DbWriteFailureSignal {
  const now = opts?.now ?? Date.now()
  const alertWindowMs = opts?.alertWindowMs ?? writeFailureAlertWindowMs()
  const lines = text ? text.split('\n') : []
  const bySignature: Record<string, number> = {}
  let count = 0
  let firstSeen: number | null = null
  let lastSeen: number | null = null

  for (const line of lines) {
    if (!LOG_LINE_RE.test(line)) continue // not a leveled log line
    const lower = line.toLowerCase()
    let matched = false
    for (const sig of DB_WRITE_FAILURE_SIGNATURES) {
      if (lower.includes(sig)) {
        bySignature[sig] = (bySignature[sig] ?? 0) + 1
        matched = true
      }
    }
    if (!matched) continue
    count++
    const ts = parseLogLineTimestamp(line)
    if (ts !== null) {
      if (firstSeen === null || ts < firstSeen) firstSeen = ts
      if (lastSeen === null || ts > lastSeen) lastSeen = ts
    }
  }

  // Unparseable timestamps mean unknown recency — degrade to warn rather
  // than latching a red badge (or hiding the count entirely).
  const recent = count > 0 && lastSeen !== null && now - lastSeen <= alertWindowMs

  return { count, firstSeen, lastSeen, recent, bySignature, scannedLines: lines.length }
}

/**
 * Scan the tail of `<dataDir>/logs/errors.log` for write-failure signatures.
 * When the current file holds fewer than `lines` lines (fresh rotation), the
 * remainder of the window is filled from `errors.log.1`.
 */
export function scanErrorLogForWriteFailures(
  dataDir: string,
  lines = DEFAULT_SCAN_LINES,
): DbWriteFailureSignal {
  const logPath = path.join(dataDir, 'logs', 'errors.log')
  let text = tailLogFile(logPath, lines)
  const got = text ? text.split('\n').length : 0
  if (got < lines) {
    const rotated = tailLogFile(`${logPath}.1`, lines - got)
    if (rotated) text = text ? `${rotated}\n${text}` : rotated
  }
  return scanLogTextForWriteFailures(text)
}

// Log scans are cheap but not free (bounded file read per harness); cache
// briefly so a 5s-polling fleet page doesn't re-read every log on every tick.
const writeFailureCache = new Map<string, { signal: DbWriteFailureSignal; ts: number }>()
const WRITE_FAILURE_TTL_MS = 60_000

export function getWriteFailureSignal(harnessId: string): DbWriteFailureSignal {
  const cached = writeFailureCache.get(harnessId)
  if (cached && Date.now() - cached.ts < WRITE_FAILURE_TTL_MS) return cached.signal
  const signal = scanErrorLogForWriteFailures(dataDirForHarnessId(harnessId))
  writeFailureCache.set(harnessId, { signal, ts: Date.now() })
  return signal
}

// --- Fleet sweep + cache ----------------------------------------------------

export type SweepTarget = { harnessId: string; name: string; dataDir: string }

const SWEEP_STAGGER_MS = 250

// Corruption hysteresis (audit H1): a torn read of a live WAL DB across the
// VirtioFS boundary can present as genuine SQLITE_CORRUPT on a perfectly
// healthy DB — and a false red badge primes an operator to run destructive
// recovery. So a single non-ok quick_check is NEVER surfaced as 'corrupt':
// the first corrupt sample publishes 'recheck-pending' (yellow) and schedules
// a re-check after a short delay; only a second consecutive corrupt sample
// (re-check or next sweep) confirms 'corrupt'. Any non-corrupt sample clears
// the pending state.
const DEFAULT_RECHECK_DELAY_MS = 5 * 60 * 1000 // 5 min — outlast a write burst

function recheckDelayMs(): number {
  const env = parseInt(process.env.INTEGRITY_RECHECK_DELAY_MS ?? '', 10)
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_RECHECK_DELAY_MS
}

const integrityCache = new Map<string, FleetIntegrityEntry>()
const unconfirmedCorruption = new Map<string, { detectedAt: number }>()
const recheckTimers = new Map<string, ReturnType<typeof setTimeout>>()
let lastSweepAt: number | null = null
let sweepInProgress = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Build a sweep target from a harness id/name pair (host-path transport). */
export function sweepTargetFor(harnessId: string, name: string): SweepTarget {
  return { harnessId, name, dataDir: agentDataDirForName(name) }
}

/** Publish a raw check result through the corruption-hysteresis gate. */
function applyCheckResult(t: SweepTarget, result: DbIntegrityResult, delayMs: number): void {
  if (result.status !== 'corrupt') {
    unconfirmedCorruption.delete(t.harnessId)
    integrityCache.set(t.harnessId, { harnessId: t.harnessId, name: t.name, ...result })
    return
  }
  if (unconfirmedCorruption.has(t.harnessId)) {
    // Second consecutive corrupt sample → confirmed.
    integrityCache.set(t.harnessId, { harnessId: t.harnessId, name: t.name, ...result })
    return
  }
  unconfirmedCorruption.set(t.harnessId, { detectedAt: Date.now() })
  integrityCache.set(t.harnessId, {
    harnessId: t.harnessId,
    name: t.name,
    ...result,
    status: 'recheck-pending',
  })
  scheduleCorruptionRecheck(t, delayMs)
}

function scheduleCorruptionRecheck(t: SweepTarget, delayMs: number): void {
  if (recheckTimers.has(t.harnessId)) return
  const timer = setTimeout(() => {
    recheckTimers.delete(t.harnessId)
    try {
      if (!unconfirmedCorruption.has(t.harnessId)) return // cleared meanwhile
      applyCheckResult(t, checkDbAtDir(t.dataDir), delayMs)
    } catch (err) {
      console.error('[integrity] corruption re-check failed:', err)
    }
  }, delayMs)
  timer.unref?.()
  recheckTimers.set(t.harnessId, timer)
}

/**
 * Check every target sequentially (one DB at a time — quick_check is
 * synchronous) with a short yield between harnesses, and cache results.
 * Re-entrant calls while a sweep is running return the current snapshot.
 */
export async function runFleetIntegritySweep(
  targets: SweepTarget[],
  staggerMs = SWEEP_STAGGER_MS,
  corruptionRecheckDelayMs = recheckDelayMs(),
): Promise<FleetIntegritySnapshot> {
  if (sweepInProgress) return getFleetIntegritySnapshot()
  sweepInProgress = true
  try {
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      applyCheckResult(t, checkDbAtDir(t.dataDir), corruptionRecheckDelayMs)
      if (staggerMs > 0 && i < targets.length - 1) await sleep(staggerMs)
    }
    // Drop entries for harnesses that no longer exist.
    const ids = new Set(targets.map((t) => t.harnessId))
    for (const key of integrityCache.keys()) {
      if (!ids.has(key)) integrityCache.delete(key)
    }
    for (const key of unconfirmedCorruption.keys()) {
      if (!ids.has(key)) unconfirmedCorruption.delete(key)
    }
    lastSweepAt = Date.now()
  } finally {
    sweepInProgress = false
  }
  return getFleetIntegritySnapshot()
}

export function getIntegrityForHarness(harnessId: string): FleetIntegrityEntry | null {
  return integrityCache.get(harnessId) ?? null
}

export function getFleetIntegritySnapshot(): FleetIntegritySnapshot {
  return {
    lastSweepAt,
    sweepInProgress,
    results: Array.from(integrityCache.values()),
  }
}

/** Reset all module state. Test hook only. */
export function _resetIntegrityStateForTests(): void {
  integrityCache.clear()
  writeFailureCache.clear()
  unconfirmedCorruption.clear()
  for (const timer of recheckTimers.values()) clearTimeout(timer)
  recheckTimers.clear()
  lastSweepAt = null
  sweepInProgress = false
}
