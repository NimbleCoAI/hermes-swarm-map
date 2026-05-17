'use client'

import { useApi } from '@/lib/hooks/use-api'
import { StatusDot } from '@/components/shared/status-dot'
import { TierBadge } from '@/components/shared/tier-badge'
import { Button } from '@/components/ui/button'
import type { Harness } from '@/lib/types'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

export default function HarnessesPage() {
  const router = useRouter()
  const { data: harnesses, loading, refetch } = useApi<Harness[]>('/api/harnesses', 5000)

  const running = harnesses?.filter((h) => h.status === 'running') ?? []

  async function restartAll() {
    try {
      const res = await fetch('/api/harnesses/restart-running', { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      toast.success(`Restarting ${running.length} harnesses`)
      refetch()
    } catch {
      toast.error('Restart failed')
    }
  }

  async function restartOne(id: string) {
    try {
      const res = await fetch(`/api/harnesses/${id}/restart`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      toast.success('Harness restarted')
      refetch()
    } catch {
      toast.error('Restart failed')
    }
  }

  async function stopOne(id: string) {
    try {
      const res = await fetch(`/api/harnesses/${id}/stop`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      toast.success('Harness stopped')
      refetch()
    } catch {
      toast.error('Stop failed')
    }
  }

  function createNew() {
    router.push('/setup/wizard')
  }

  async function importHarness() {
    const dataDir = window.prompt('Path to harness data directory (e.g. ~/.hermes-myagent):')
    if (!dataDir?.trim()) return

    const name = window.prompt('Name for the imported harness:')
    if (!name?.trim()) return

    try {
      const res = await fetch('/api/harnesses/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataDir: dataDir.trim(), name: name.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Import failed')
        return
      }
      toast.success(`Imported "${name.trim()}"`)
      refetch()
    } catch {
      toast.error('Import failed')
    }
  }

  async function duplicateOne(id: string, currentName: string) {
    const newName = window.prompt('Name for the duplicate harness:', `${currentName}-copy`)
    if (!newName?.trim()) return
    try {
      const res = await fetch(`/api/harnesses/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Duplicate failed')
        return
      }
      toast.success(`Duplicated as "${newName.trim()}"`)
      refetch()
    } catch {
      toast.error('Duplicate failed')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Harnesses</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={createNew}>
            Create New
          </Button>
          <Button variant="outline" size="sm" onClick={importHarness}>
            Import
          </Button>
          {running.length > 0 && (
            <Button variant="outline" size="sm" onClick={restartAll}>
              Restart all running ({running.length})
            </Button>
          )}
        </div>
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && harnesses && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">Tier</th>
                <th className="text-left px-4 py-3">Platform</th>
                <th className="text-left px-4 py-3">Model</th>
                <th className="text-right px-4 py-3">Cost</th>
                <th className="text-right px-4 py-3">Inv</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {harnesses.map((h) => (
                <tr key={h.id} className="border-b border-[var(--border)] last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/harnesses/${h.id}`} className="flex items-center gap-2 hover:underline">
                      <StatusDot status={h.status} />
                      <span className="font-medium">{h.name}</span>
                      {h.health.errors > 0 && (
                        <span className="text-xs text-destructive">({h.health.errors} err)</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <TierBadge tier={h.tier} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{h.platform} / {h.channel}</td>
                  <td className="px-4 py-3 text-muted-foreground">{h.models[0]}</td>
                  <td className="px-4 py-3 text-right">${h.costToday.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">{h.invocations}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="xs" onClick={() => restartOne(h.id)}>
                        Restart
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => stopOne(h.id)}>
                        Stop
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => duplicateOne(h.id, h.name)} title="Duplicate">
                        ⧉
                      </Button>
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
