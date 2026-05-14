'use client'

import { useApi } from '@/lib/hooks/use-api'
import { TierBadge } from '@/components/shared/tier-badge'
import type { MemoryScope, Harness } from '@/lib/types'

const STRATEGY_LABELS: Record<MemoryScope['strategy'], string> = {
  'siloed-runtime': 'Siloed',
  'tag-gated': 'Tag-gated',
}

const STRATEGY_STYLES: Record<MemoryScope['strategy'], string> = {
  'siloed-runtime': 'bg-muted text-muted-foreground',
  'tag-gated': 'bg-[var(--accent)]/10 text-[var(--accent)]',
}

export default function MemoryPage() {
  const { data: scopes, loading } = useApi<MemoryScope[]>('/api/memory-scopes')
  const { data: harnesses } = useApi<Harness[]>('/api/harnesses')

  function memberNames(ids: string[]): string {
    if (!harnesses) return `${ids.length} members`
    return ids.map((id) => harnesses.find((h) => h.id === id)?.name ?? id).join(', ')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Memory Scopes</h2>
        {scopes && <span className="text-sm text-muted-foreground">{scopes.length} scopes</span>}
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && scopes && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {scopes.map((scope) => (
            <div
              key={scope.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-medium">{scope.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STRATEGY_STYLES[scope.strategy]}`}>
                      {STRATEGY_LABELS[scope.strategy]}
                    </span>
                    <TierBadge tier={scope.tier} />
                  </div>
                </div>
                <span className="text-sm text-muted-foreground">{scope.sizeMb.toFixed(1)} MB</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {scope.members.length > 0
                  ? `${scope.members.length} member${scope.members.length !== 1 ? 's' : ''}: ${memberNames(scope.members)}`
                  : 'No members.'}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
