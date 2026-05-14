'use client'

import { useApi } from '@/lib/hooks/use-api'
import type { AuditEntry } from '@/lib/types'

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function absoluteTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

export default function AuditPage() {
  const { data: entries, loading } = useApi<AuditEntry[]>('/api/audit', 5000)

  const sorted = entries ? [...entries].reverse() : []

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Audit Log</h2>
        {entries && <span className="text-sm text-muted-foreground">{entries.length} entries</span>}
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && sorted.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Time</th>
                <th className="text-left px-4 py-3">Who</th>
                <th className="text-left px-4 py-3">What</th>
                <th className="text-left px-4 py-3">Target</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((entry, i) => (
                <tr key={i} className="border-b border-[var(--border)] last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    <span title={absoluteTime(entry.ts)} className="cursor-default">
                      {relativeTime(entry.ts)}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-medium">{entry.who}</td>
                  <td className="px-4 py-3 text-muted-foreground">{entry.what}</td>
                  <td className="px-4 py-3 text-muted-foreground">{entry.target}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <p className="text-sm text-muted-foreground">No audit entries yet.</p>
      )}
    </div>
  )
}
