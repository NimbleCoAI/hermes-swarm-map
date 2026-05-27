'use client'

import { useState } from 'react'
import { useApi } from '@/lib/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { TierBadge } from '@/components/shared/tier-badge'
import { StatusDot } from '@/components/shared/status-dot'
import { toast } from 'sonner'
import type { Settings, Harness } from '@/lib/types'

export default function SettingsPage() {
  const { data: settings, loading: sLoading, refetch } = useApi<Settings>('/api/settings')
  const { data: harnesses, loading: hLoading, refetch: refetchHarnesses } = useApi<Harness[]>('/api/harnesses', 5000)
  const [saving, setSaving] = useState(false)
  const [fleetAction, setFleetAction] = useState<string | null>(null)

  const running = harnesses?.filter((h) => h.status === 'running') ?? []
  const stopped = harnesses?.filter((h) => h.status === 'stopped') ?? []

  async function updateSetting(partial: Partial<Settings>) {
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      if (res.ok) {
        await refetch()
      } else {
        toast.error('Failed to update setting')
      }
    } catch {
      toast.error('Failed to update setting')
    } finally {
      setSaving(false)
    }
  }

  async function toggleLocalBuild() {
    if (!settings) return
    const next = !settings.useLocalBuild
    await updateSetting({ useLocalBuild: next })
    toast.success(next ? 'Local build enabled' : 'Local build disabled')
  }

  async function toggleLocalApi() {
    if (!settings) return
    const next = !settings.localApiEnabled
    await updateSetting({ localApiEnabled: next })
    toast.success(next ? 'Local API enabled' : 'Local API disabled')
  }

  async function restartAll() {
    setFleetAction('restart')
    try {
      const res = await fetch('/api/harnesses/restart-running', { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const count = data.restarted?.length ?? running.length
      const errorCount = data.errors ? Object.keys(data.errors).length : 0
      if (errorCount > 0) {
        toast.warning(`Restarted ${count} harnesses, ${errorCount} failed`)
      } else {
        toast.success(`Restarting ${count} harnesses`)
      }
      refetchHarnesses()
    } catch {
      toast.error('Restart failed')
    } finally {
      setFleetAction(null)
    }
  }

  async function stopAll() {
    setFleetAction('stop')
    const promises = running.map((h) =>
      fetch(`/api/harnesses/${h.id}/stop`, { method: 'POST' })
    )
    try {
      const results = await Promise.allSettled(promises)
      const failures = results.filter((r) => r.status === 'rejected').length
      if (failures > 0) {
        toast.warning(`Stopped ${running.length - failures} harnesses, ${failures} failed`)
      } else {
        toast.success(`Stopped ${running.length} harnesses`)
      }
      refetchHarnesses()
    } catch {
      toast.error('Stop all failed')
    } finally {
      setFleetAction(null)
    }
  }

  async function startAll() {
    setFleetAction('start')
    const promises = stopped.map((h) =>
      fetch(`/api/harnesses/${h.id}/start`, { method: 'POST' })
    )
    try {
      const results = await Promise.allSettled(promises)
      const failures = results.filter((r) => r.status === 'rejected').length
      if (failures > 0) {
        toast.warning(`Started ${stopped.length - failures} harnesses, ${failures} failed`)
      } else {
        toast.success(`Starting ${stopped.length} harnesses`)
      }
      refetchHarnesses()
    } catch {
      toast.error('Start all failed')
    } finally {
      setFleetAction(null)
    }
  }

  const localApiPort = settings?.localApiPort ?? 8600

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold">Settings</h2>

      {/* Runtime Info */}
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

      {/* Build Source */}
      {!sLoading && settings && (
        <section>
          <h3 className="text-base font-medium mb-3">Build Source</h3>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Build from local source</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When enabled, new agents build from <span className="font-mono">{settings.hermesDir}</span> instead of pulling <span className="font-mono">nousresearch/hermes-agent:latest</span>
                </p>
              </div>
              <Switch
                checked={!!settings.useLocalBuild}
                onCheckedChange={toggleLocalBuild}
                disabled={saving}
              />
            </div>
          </div>
        </section>
      )}

      {/* Fleet Controls */}
      <section>
        <h3 className="text-base font-medium mb-3">Fleet Controls</h3>
        {hLoading && <p className="text-muted-foreground">Loading...</p>}
        {!hLoading && harnesses && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
            {/* Fleet status summary */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <StatusDot status="running" />
                <span>{running.length} running</span>
              </div>
              <div className="flex items-center gap-1.5">
                <StatusDot status="stopped" />
                <span>{stopped.length} stopped</span>
              </div>
              <div className="text-muted-foreground">
                {harnesses.length} total
              </div>
            </div>

            {/* Fleet action buttons */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={restartAll}
                disabled={running.length === 0 || !!fleetAction}
              >
                {fleetAction === 'restart' ? 'Restarting...' : `Restart All (${running.length})`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={stopAll}
                disabled={running.length === 0 || !!fleetAction}
              >
                {fleetAction === 'stop' ? 'Stopping...' : `Stop All (${running.length})`}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={startAll}
                disabled={stopped.length === 0 || !!fleetAction}
              >
                {fleetAction === 'start' ? 'Starting...' : `Start All Stopped (${stopped.length})`}
              </Button>
            </div>

            {/* Per-harness quick actions */}
            {harnesses.length > 0 && (
              <div className="border-t border-[var(--border)] pt-3">
                <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Individual Harnesses</p>
                <div className="space-y-1">
                  {harnesses.map((h) => (
                    <HarnessRow key={h.id} harness={h} onAction={() => refetchHarnesses()} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Local API */}
      {!sLoading && settings && (
        <section>
          <h3 className="text-base font-medium mb-3">Local API</h3>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Expose harnesses via local API</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When enabled, running harnesses are accessible at a local HTTP endpoint for external tools and scripts.
                </p>
              </div>
              <Switch
                checked={!!settings.localApiEnabled}
                onCheckedChange={toggleLocalApi}
                disabled={saving}
              />
            </div>
            {settings.localApiEnabled && (
              <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Endpoint</span>
                  <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                    http://localhost:{localApiPort}/v1
                  </code>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Port</span>
                  <PortInput
                    value={localApiPort}
                    onSave={(port) => updateSetting({ localApiPort: port })}
                    disabled={saving}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Available routes: <code className="font-mono">/v1/harnesses</code>, <code className="font-mono">/v1/harnesses/:id</code>, <code className="font-mono">/v1/harnesses/:id/restart</code>
                </p>
              </div>
            )}
          </div>
        </section>
      )}

    </div>
  )
}

/* ── Inline sub-components ── */

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs text-right' : ''}>{value}</span>
    </div>
  )
}

function HarnessRow({ harness, onAction }: { harness: Harness; onAction: () => void }) {
  const [acting, setActing] = useState(false)

  async function restart() {
    setActing(true)
    try {
      const res = await fetch(`/api/harnesses/${harness.id}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'quick' }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success(`${harness.name} restarted`)
      onAction()
    } catch {
      toast.error(`Failed to restart ${harness.name}`)
    } finally {
      setActing(false)
    }
  }

  async function toggle() {
    setActing(true)
    const action = harness.status === 'running' ? 'stop' : 'start'
    try {
      const res = await fetch(`/api/harnesses/${harness.id}/${action}`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      toast.success(`${harness.name} ${action === 'stop' ? 'stopped' : 'started'}`)
      onAction()
    } catch {
      toast.error(`Failed to ${action} ${harness.name}`)
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="flex items-center justify-between py-1.5 px-2 rounded-md hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-2">
        <StatusDot status={harness.status} />
        <span className="text-sm font-medium">{harness.name}</span>
        <TierBadge tier={harness.tier} />
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          onClick={restart}
          disabled={acting || harness.status === 'stopped' || harness.status === 'restarting'}
        >
          {harness.status === 'restarting' ? 'Rebuilding...' : 'Restart'}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={toggle}
          disabled={acting}
        >
          {harness.status === 'running' ? 'Stop' : 'Start'}
        </Button>
      </div>
    </div>
  )
}

function PortInput({ value, onSave, disabled }: { value: number; onSave: (v: number) => void; disabled: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(String(value)); setEditing(true) }}
        className="text-xs font-mono px-2 py-0.5 rounded border border-transparent hover:border-[var(--border)] transition-colors"
        disabled={disabled}
      >
        {value}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const port = parseInt(draft, 10)
            if (port > 0 && port < 65536) {
              onSave(port)
              setEditing(false)
            }
          }
          if (e.key === 'Escape') setEditing(false)
        }}
        className="w-20 text-xs font-mono border border-[var(--border)] rounded px-1.5 py-0.5 bg-[var(--bg)]"
        autoFocus
        min={1}
        max={65535}
      />
      <button
        onClick={() => {
          const port = parseInt(draft, 10)
          if (port > 0 && port < 65536) {
            onSave(port)
            setEditing(false)
          }
        }}
        className="text-xs text-[var(--accent)] hover:underline"
      >
        Save
      </button>
      <button
        onClick={() => setEditing(false)}
        className="text-xs text-muted-foreground hover:underline"
      >
        Cancel
      </button>
    </div>
  )
}

