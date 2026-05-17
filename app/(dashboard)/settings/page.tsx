'use client'

import { useState } from 'react'
import { useApi } from '@/lib/hooks/use-api'
import { toast } from 'sonner'
import type { Settings } from '@/lib/types'

export default function SettingsPage() {
  const { data: settings, loading: sLoading, refetch } = useApi<Settings>('/api/settings')
  const [saving, setSaving] = useState(false)

  async function toggleLocalBuild() {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useLocalBuild: !settings.useLocalBuild }),
      })
      const updated = await res.json()
      if (res.ok) {
        await refetch()
        toast.success(updated.useLocalBuild ? 'Local build enabled' : 'Local build disabled')
      } else {
        toast.error('Failed to update setting')
      }
    } catch {
      toast.error('Failed to update setting')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Settings</h2>

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

      {/* Build source */}
      {!sLoading && settings && (
        <section className="mt-6">
          <h3 className="text-base font-medium mb-3">Build Source</h3>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Build from local source</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  When enabled, new agents build from <span className="font-mono">{settings.hermesDir}</span> instead of pulling <span className="font-mono">nousresearch/hermes-agent:latest</span>
                </p>
              </div>
              <button
                onClick={toggleLocalBuild}
                disabled={saving}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.useLocalBuild ? 'bg-[var(--accent)]' : 'bg-[var(--border)]'
                } disabled:opacity-50`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.useLocalBuild ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </section>
      )}
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
