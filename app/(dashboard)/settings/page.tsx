'use client'

import { useApi } from '@/lib/hooks/use-api'
import { Button } from '@/components/ui/button'
import type { Model, Settings } from '@/lib/types'
import { toast } from 'sonner'

export default function SettingsPage() {
  const { data: models, loading: mLoading, refetch: refetchModels } = useApi<Model[]>('/api/models')
  const { data: settings, loading: sLoading } = useApi<Settings>('/api/settings')

  async function toggleAccess(model: Model) {
    const newTier = model.accessTier === 'open' ? 'admin' : 'open'
    try {
      const res = await fetch(`/api/models/${model.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessTier: newTier }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success(`${model.name} set to ${newTier}`)
      refetchModels()
    } catch {
      toast.error('Update failed')
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Settings</h2>

      {/* Model gating */}
      <section className="mb-8">
        <h3 className="text-base font-medium mb-3">Model Access Gating</h3>
        {mLoading && <p className="text-muted-foreground">Loading models...</p>}
        {!mLoading && models && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Model</th>
                  <th className="text-left px-4 py-3">Vendor</th>
                  <th className="text-left px-4 py-3">Cost Class</th>
                  <th className="text-left px-4 py-3">Access</th>
                  <th className="text-right px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--border)] last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium">{m.name}</div>
                      {m.notes && <div className="text-xs text-muted-foreground">{m.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{m.vendor}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                        {m.costClass}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${m.accessTier === 'open' ? 'text-[var(--success)]' : 'text-[var(--warning)]'}`}>
                        {m.accessTier === 'open' ? 'Open' : 'Admin only'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => toggleAccess(m)}
                      >
                        {m.accessTier === 'open' ? 'Restrict' : 'Open'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Runtime info */}
      <section>
        <h3 className="text-base font-medium mb-3">Runtime Info</h3>
        {sLoading && <p className="text-muted-foreground">Loading...</p>}
        {!sLoading && settings && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 text-sm">
            <Row label="Hermes directory" value={settings.hermesDir} mono />
            <Row label="Data directory" value={settings.dataDir} mono />
            <Row label="Theme" value={settings.theme} />
          </div>
        )}
      </section>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs text-right' : ''}>{value}</span>
    </div>
  )
}
