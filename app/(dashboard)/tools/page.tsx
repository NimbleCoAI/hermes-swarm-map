'use client'

import { useApi } from '@/lib/hooks/use-api'
import { RiskBar } from '@/components/shared/risk-bar'
import { TierMix } from '@/components/shared/tier-mix'
import type { Tool } from '@/lib/types'

const SOURCE_LABELS: Record<string, string> = {
  builtin: 'Built-in',
  mcp: 'MCP',
  custom: 'Custom',
}

export default function ToolsPage() {
  const { data: tools, loading } = useApi<Tool[]>('/api/tools')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Tools</h2>
        {tools && <span className="text-sm text-muted-foreground">{tools.length} registered</span>}
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && tools && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Tool</th>
                <th className="text-left px-4 py-3">Source</th>
                <th className="text-left px-4 py-3">Risk</th>
                <th className="text-left px-4 py-3">Allowed Tiers</th>
                <th className="text-left px-4 py-3">Reviewed</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground max-w-xs truncate">{t.description}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {SOURCE_LABELS[t.source] ?? t.source}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <RiskBar level={t.risk} />
                  </td>
                  <td className="px-4 py-3">
                    <TierMix tiers={t.allowedTiers} />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${t.reviewed ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                      {t.reviewed ? 'Reviewed' : 'Pending'}
                    </span>
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
