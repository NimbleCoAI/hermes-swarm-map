'use client'

import { useApi } from '@/lib/hooks/use-api'
import { TierMix } from '@/components/shared/tier-mix'
import { StatusDot } from '@/components/shared/status-dot'
import type { Key, Harness } from '@/lib/types'
import type { HabitatTier, HarnessStatus } from '@/lib/types'

function keyHealthToStatus(health: Key['health']): HarnessStatus {
  if (health === 'good') return 'running'
  if (health === 'warning') return 'idle'
  return 'error'
}

export default function KeysPage() {
  const { data: keys, loading } = useApi<Key[]>('/api/keys')
  const { data: harnesses } = useApi<Harness[]>('/api/harnesses')

  function harnessNames(ids: string[]): string {
    if (!harnesses) return ids.join(', ')
    return ids.map((id) => harnesses.find((h) => h.id === id)?.name ?? id).join(', ')
  }

  function tierMixForKey(key: Key): HabitatTier[] {
    if (!harnesses) return []
    const assigned = harnesses.filter((h) => key.assignedTo.includes(h.id))
    return [...new Set(assigned.map((h) => h.tier))] as HabitatTier[]
  }

  function touchesPublic(key: Key): boolean {
    return tierMixForKey(key).includes('public')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Keys</h2>
        {keys && <span className="text-sm text-muted-foreground">{keys.length} keys</span>}
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && keys && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Provider</th>
                <th className="text-left px-4 py-3">Key</th>
                <th className="text-left px-4 py-3">Assigned To</th>
                <th className="text-left px-4 py-3">Tier Mix</th>
                <th className="text-right px-4 py-3">Budget</th>
                <th className="text-left px-4 py-3">Health</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k.id}
                  className={`border-b border-[var(--border)] last:border-0 hover:bg-muted/30 transition-colors ${touchesPublic(k) ? 'ring-1 ring-[var(--warning)]/40' : ''}`}
                >
                  <td className="px-4 py-3 font-medium">{k.provider}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{k.maskedValue}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">
                    {k.assignedTo.length > 0 ? harnessNames(k.assignedTo) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {tierMixForKey(k).length > 0 ? <TierMix tiers={tierMixForKey(k)} /> : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {k.budgetUsd != null ? `$${k.budgetUsd}/mo` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={keyHealthToStatus(k.health)} />
                      <span className="text-xs capitalize">{k.health}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
