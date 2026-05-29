'use client'

import { useState } from 'react'
import { useApi } from '@/lib/hooks/use-api'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import type { Settings } from '@/lib/types'

export default function SettingsPage() {
  const { data: settings, loading: sLoading, refetch } = useApi<Settings>('/api/settings')
  const [saving, setSaving] = useState(false)

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

  const localApiPort = settings?.localApiPort ?? 8600

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-semibold">Settings</h2>

      <div className="rounded-lg border border-[var(--border)] bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Per-harness settings (access policies, mention-gating, memory scope) are managed from each harness's detail page.
      </div>

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

