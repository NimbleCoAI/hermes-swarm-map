'use client'

import { useApi } from '@/lib/hooks/use-api'
import type { Settings } from '@/lib/types'

export default function SettingsPage() {
  const { data: settings, loading: sLoading } = useApi<Settings>('/api/settings')

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
