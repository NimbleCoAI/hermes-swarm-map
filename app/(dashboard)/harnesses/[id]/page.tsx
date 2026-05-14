'use client'

import { use } from 'react'
import { useApi } from '@/lib/hooks/use-api'
import { StatusDot } from '@/components/shared/status-dot'
import { TierBadge } from '@/components/shared/tier-badge'
import { CacheStatePill } from '@/components/shared/cache-state-pill'
import { SplitButton } from '@/components/shared/split-button'
import { RiskBar } from '@/components/shared/risk-bar'
import { TierMix } from '@/components/shared/tier-mix'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Harness, Tool, Key, MemoryScope, Surface } from '@/lib/types'
import { toast } from 'sonner'

export default function HarnessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data: harness, loading, refetch } = useApi<Harness>(`/api/harnesses/${id}`)
  const { data: tools } = useApi<Tool[]>('/api/tools')
  const { data: keys } = useApi<Key[]>('/api/keys')
  const { data: memoryScopes } = useApi<MemoryScope[]>('/api/memory-scopes')
  const { data: surfaces } = useApi<Surface[]>('/api/surfaces')

  async function doRestart(mode: string) {
    try {
      const res = await fetch(`/api/harnesses/${id}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success(`Harness restarted (${mode})`)
      refetch()
    } catch {
      toast.error('Restart failed')
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>
  if (!harness) return <p className="text-destructive">Harness not found.</p>

  const harnessTools = tools?.filter((t) => harness.tools.includes(t.id)) ?? []
  const harnessKeys = keys?.filter((k) => k.assignedTo.includes(harness.id)) ?? []
  const harnessMemory = memoryScopes?.filter((m) => m.members.includes(harness.id)) ?? []
  const harnessSurfaces = surfaces?.filter((s) => s.harnessIds.includes(harness.id)) ?? []

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <StatusDot status={harness.status} />
          <div>
            <h2 className="text-2xl font-semibold">{harness.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <TierBadge tier={harness.tier} />
              <span className="text-sm text-muted-foreground">{harness.persona}</span>
              {harness.cacheState && (
                <CacheStatePill state={harness.cacheState} age={harness.cacheAge} />
              )}
            </div>
          </div>
        </div>
        <SplitButton
          label="Quick Restart"
          onClick={() => doRestart('quick')}
          disabled={harness.status === 'stopped'}
          items={[
            { label: 'Rebuild', description: 'Rebuild container', onClick: () => doRestart('rebuild') },
            { label: 'Purge & Restart', description: 'Clear cache and restart', onClick: () => doRestart('purge') },
          ]}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tools">Tools ({harnessTools.length})</TabsTrigger>
          <TabsTrigger value="surfaces">Surfaces ({harnessSurfaces.length})</TabsTrigger>
          <TabsTrigger value="keys">Keys ({harnessKeys.length})</TabsTrigger>
          <TabsTrigger value="memory">Memory ({harnessMemory.length})</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <h3 className="font-medium text-sm">Runtime</h3>
              <Row label="Runtime" value={harness.runtime} />
              <Row label="Platform" value={`${harness.platform} / ${harness.channel}`} />
              <Row label="Status" value={harness.status} />
              <Row label="Models" value={harness.models.join(', ')} />
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <h3 className="font-medium text-sm">Usage</h3>
              <Row label="Invocations" value={harness.invocations} />
              <Row label="Cost today" value={`$${harness.costToday.toFixed(2)}`} />
              <Row label="CPU" value={`${harness.cpu}%`} />
              <Row label="Memory" value={`${harness.mem}%`} />
            </div>
            {harness.health.errors > 0 && (
              <div className="col-span-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)]/5 p-4">
                <p className="text-sm font-medium text-destructive">{harness.health.errors} error(s)</p>
                {harness.health.errorMsg && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{harness.health.errorMsg}</p>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Tool</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Risk</th>
                  <th className="text-left px-4 py-3">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {harnessTools.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.source}</td>
                    <td className="px-4 py-3"><RiskBar level={t.risk} /></td>
                    <td className="px-4 py-3">
                      <span className={t.reviewed ? 'text-[var(--success)]' : 'text-muted-foreground'}>
                        {t.reviewed ? 'Yes' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
                {harnessTools.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-sm">No tools assigned.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="surfaces" className="mt-4">
          <div className="space-y-2">
            {harnessSurfaces.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div>
                  <p className="font-medium text-sm">{s.name}</p>
                  <p className="text-xs text-muted-foreground">{s.platform}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'connected' ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-muted text-muted-foreground'}`}>
                  {s.status}
                </span>
              </div>
            ))}
            {harnessSurfaces.length === 0 && <p className="text-sm text-muted-foreground">No surfaces connected.</p>}
          </div>
        </TabsContent>

        <TabsContent value="keys" className="mt-4">
          <div className="space-y-2">
            {harnessKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div>
                  <p className="font-medium text-sm">{k.provider}</p>
                  <p className="text-xs font-mono text-muted-foreground">{k.maskedValue}</p>
                </div>
                {k.budgetUsd && (
                  <span className="text-xs text-muted-foreground">${k.budgetUsd}/mo</span>
                )}
              </div>
            ))}
            {harnessKeys.length === 0 && <p className="text-sm text-muted-foreground">No keys assigned.</p>}
          </div>
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <div className="space-y-2">
            {harnessMemory.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div>
                  <p className="font-medium text-sm">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.strategy} · {m.sizeMb.toFixed(1)} MB</p>
                </div>
                <TierBadge tier={m.tier} />
              </div>
            ))}
            {harnessMemory.length === 0 && <p className="text-sm text-muted-foreground">No memory scopes assigned.</p>}
          </div>
        </TabsContent>

        <TabsContent value="environment" className="mt-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
            <h3 className="font-medium text-sm">Compose Config</h3>
            {harness.composeFile && <Row label="Compose file" value={harness.composeFile} mono />}
            {harness.serviceName && <Row label="Service name" value={harness.serviceName} mono />}
            {!harness.composeFile && !harness.serviceName && (
              <p className="text-sm text-muted-foreground">No environment config.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  )
}
