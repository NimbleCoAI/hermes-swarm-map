// DB health badge (#204, PR1). Types are structural mirrors of the API
// payloads — this is a client component, so it must not import from server
// modules that pull in better-sqlite3.

export type DbIntegritySummary = {
  status: 'ok' | 'no-db' | 'busy' | 'corrupt' | 'error'
  detail: string | null
  checkedAt: number
}

export type DbWriteFailureSummary = {
  count: number
  firstSeen: number | null
  lastSeen: number | null
}

type Level = 'ok' | 'warn' | 'alert'

const styles: Record<Level, string> = {
  ok: 'bg-green-500/10 text-green-600',
  warn: 'bg-orange-500/10 text-orange-500',
  alert: 'bg-red-500/10 text-red-600',
}

// A cached result older than a day means the sweep has stopped covering this
// harness — surface that as a warning rather than a stale green.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000

function levelFor(
  integrity: DbIntegritySummary | null | undefined,
  writeFailures: DbWriteFailureSummary | null | undefined,
): { level: Level; title: string } | null {
  const parts: string[] = []
  let level: Level | null = null

  if (writeFailures && writeFailures.count > 0) {
    level = 'alert'
    const last = writeFailures.lastSeen ? new Date(writeFailures.lastSeen).toLocaleString() : null
    parts.push(
      `${writeFailures.count} DB write failure${writeFailures.count === 1 ? '' : 's'} in recent error log${last ? ` (last ${last})` : ''}`,
    )
  }

  if (integrity) {
    const stale = Date.now() - integrity.checkedAt > STALE_AFTER_MS
    switch (integrity.status) {
      case 'ok':
        if (stale) {
          level = level ?? 'warn'
          parts.push('integrity check stale (last sweep >24h ago)')
        } else {
          level = level ?? 'ok'
          parts.push(`integrity ok (checked ${new Date(integrity.checkedAt).toLocaleString()})`)
        }
        break
      case 'corrupt':
        level = 'alert'
        parts.push(`integrity check failed: ${integrity.detail ?? 'corruption detected'}`)
        break
      case 'busy':
        level = level ?? 'warn'
        parts.push('DB busy/locked during last check')
        break
      case 'error':
        level = level ?? 'warn'
        parts.push(`integrity check error: ${integrity.detail ?? 'unknown'}`)
        break
      case 'no-db':
        // Nothing to monitor — only show the badge if write failures exist.
        break
    }
  }

  if (level === null) return null
  return { level, title: parts.join(' · ') }
}

export function DbHealthBadge({
  integrity,
  writeFailures,
}: {
  integrity?: DbIntegritySummary | null
  writeFailures?: DbWriteFailureSummary | null
}) {
  const resolved = levelFor(integrity, writeFailures)
  if (!resolved) return null
  return (
    <span
      title={resolved.title}
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${styles[resolved.level]}`}
    >
      db
    </span>
  )
}
