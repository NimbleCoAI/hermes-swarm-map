'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type DetectedPath = {
  path: string
  composeCount: number
}

export default function SetupWelcomePage() {
  const router = useRouter()
  const [detected, setDetected] = useState<DetectedPath[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    fetch('/api/setup/detect')
      .then((r) => r.json())
      .then((data) => setDetected(data.paths ?? []))
      .catch(() => {})
  }, [])

  async function handleImportExisting() {
    if (!selected) return
    setImporting(true)
    try {
      await fetch('/api/setup/complete', { method: 'POST' })
      router.push('/')
    } catch {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Hermes Swarm Map</h1>
        <p className="text-muted-foreground">Agent orchestration for Hermes. Let's get you set up.</p>
      </div>

      <div className="space-y-4">
        {/* Option A — existing setup */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-base">I have Hermes agents running</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Auto-detected directories — select one to connect.
            </p>
          </div>

          {detected.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No Hermes directories found automatically.</p>
          ) : (
            <div className="space-y-2">
              {detected.map((d) => (
                <label
                  key={d.path}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    selected === d.path
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="hermes-dir"
                      value={d.path}
                      checked={selected === d.path}
                      onChange={() => setSelected(d.path)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="font-mono text-sm">{d.path}</span>
                  </div>
                  {d.composeCount > 0 && (
                    <span className="text-xs text-muted-foreground">{d.composeCount} compose file{d.composeCount !== 1 ? 's' : ''}</span>
                  )}
                </label>
              ))}
            </div>
          )}

          <Button
            onClick={handleImportExisting}
            disabled={!selected || importing}
            className="w-full"
          >
            {importing ? 'Connecting...' : 'Connect & Go to Dashboard'}
          </Button>
        </div>

        {/* Option B — create new */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-base">Create my first agent</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Walk through the setup wizard to configure and deploy a new Hermes agent.
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => router.push('/setup/wizard')}
          >
            Start Wizard
          </Button>
        </div>
      </div>
    </div>
  )
}
