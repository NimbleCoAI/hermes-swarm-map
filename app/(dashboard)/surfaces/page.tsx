'use client'

import { useApi } from '@/lib/hooks/use-api'
import type { Surface, Harness } from '@/lib/types'
import { MessageSquare, Globe, Bot, Hash } from 'lucide-react'

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  telegram: <MessageSquare className="h-5 w-5" />,
  slack: <Hash className="h-5 w-5" />,
  web: <Globe className="h-5 w-5" />,
  api: <Bot className="h-5 w-5" />,
}

const STATUS_STYLES: Record<Surface['status'], string> = {
  connected: 'bg-[var(--success)]/10 text-[var(--success)]',
  available: 'bg-muted text-muted-foreground',
  planned: 'bg-[var(--warning)]/10 text-[var(--warning)]',
}

export default function SurfacesPage() {
  const { data: surfaces, loading } = useApi<Surface[]>('/api/surfaces')
  const { data: harnesses } = useApi<Harness[]>('/api/harnesses')

  function harnessNamesForSurface(surface: Surface): string {
    if (!harnesses) return `${surface.harnessIds.length} harnesses`
    return surface.harnessIds
      .map((id) => harnesses.find((h) => h.id === id)?.name ?? id)
      .join(', ')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Surfaces</h2>
        {surfaces && <span className="text-sm text-muted-foreground">{surfaces.length} surfaces</span>}
      </div>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && surfaces && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {surfaces.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">
                    {PLATFORM_ICONS[s.platform.toLowerCase()] ?? <Globe className="h-5 w-5" />}
                  </span>
                  <span className="font-medium">{s.name}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[s.status]}`}>
                  {s.status}
                </span>
              </div>
              <p className="text-xs text-muted-foreground capitalize mb-2">{s.platform}</p>
              {s.harnessIds.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {s.harnessIds.length} harness{s.harnessIds.length !== 1 ? 'es' : ''}: {harnessNamesForSurface(s)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">No harnesses connected.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
