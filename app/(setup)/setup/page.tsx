'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

type DetectedPath = {
  path: string
  composeCount: number
  agentCount: number
}

export default function SetupWelcomePage() {
  const router = useRouter()
  const [detected, setDetected] = useState<DetectedPath[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    fetch('/api/setup/detect')
      .then((r) => r.json())
      .then((data) => {
        const paths: DetectedPath[] = data.paths ?? []
        setDetected(paths)
        // Auto-select all detected dirs
        setSelected(new Set(paths.map(p => p.path)))
      })
      .catch(() => {})
  }, [])

  function togglePath(path: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function handleImportExisting() {
    if (selected.size === 0) return
    setImporting(true)
    try {
      // Use the first selected dir as primary hermesDir
      // In the future, settings could support multiple dirs
      const primary = Array.from(selected)[0]
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hermesDir: primary, onboarded: true }),
      })
      router.push('/')
    } catch {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Hermes Swarm Map</h1>
        <p className="text-muted-foreground">Agent orchestration for Hermes. Let&apos;s get you set up.</p>
      </div>

      <div className="space-y-4">
        {/* Option A — existing setup */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
          <div>
            <h2 className="font-semibold text-base">I have Hermes agents running</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Detected compose directories with Hermes agents.
            </p>
          </div>

          {detected.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No Hermes compose directories found.</p>
          ) : (
            <div className="space-y-2">
              {detected.map((d) => (
                <label
                  key={d.path}
                  className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
                    selected.has(d.path)
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10'
                      : 'border-[var(--border)] hover:bg-muted/30'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(d.path)}
                      onChange={() => togglePath(d.path)}
                      className="accent-[var(--accent)]"
                    />
                    <span className="font-mono text-sm">{d.path}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {d.composeCount} compose file{d.composeCount !== 1 ? 's' : ''} · {d.agentCount} agent{d.agentCount !== 1 ? 's' : ''}
                  </span>
                </label>
              ))}
            </div>
          )}

          <Button
            onClick={handleImportExisting}
            disabled={selected.size === 0 || importing}
            className="w-full"
          >
            {importing ? 'Connecting...' : `Connect${selected.size > 0 ? ` (${Array.from(selected).reduce((sum, p) => sum + (detected.find(d => d.path === p)?.agentCount ?? 0), 0)} agents)` : ''}`}
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
