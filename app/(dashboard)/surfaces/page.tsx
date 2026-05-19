'use client'

import { useApi } from '@/lib/hooks/use-api'
import { StatusDot } from '@/components/shared/status-dot'
import Link from 'next/link'
import type { Surface, Harness, HarnessStatus } from '@/lib/types'
import {
  MessageSquare, Send, Hash, Radio, Plug,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const PLATFORM_META: Record<string, { icon: LucideIcon; label: string }> = {
  signal: { icon: Radio, label: 'Signal' },
  telegram: { icon: Send, label: 'Telegram' },
  mattermost: { icon: MessageSquare, label: 'Mattermost' },
  discord: { icon: Hash, label: 'Discord' },
  slack: { icon: MessageSquare, label: 'Slack' },
}

function surfaceStatusToHarnessStatus(status: Surface['status']): HarnessStatus {
  if (status === 'connected') return 'running'
  if (status === 'available') return 'idle'
  return 'stopped'
}

type PlatformGroup = {
  platform: string
  label: string
  icon: LucideIcon
  connected: Surface[]
  available: Surface[]
  planned: boolean
}

function groupByPlatform(surfaces: Surface[]): PlatformGroup[] {
  const map = new Map<string, PlatformGroup>()

  for (const s of surfaces) {
    if (!map.has(s.platform)) {
      const meta = PLATFORM_META[s.platform] ?? { icon: Plug, label: s.platform }
      map.set(s.platform, {
        platform: s.platform,
        label: meta.label,
        icon: meta.icon,
        connected: [],
        available: [],
        planned: false,
      })
    }
    const group = map.get(s.platform)!
    if (s.status === 'connected') {
      group.connected.push(s)
    } else if (s.status === 'available') {
      group.available.push(s)
    } else if (s.status === 'planned') {
      group.planned = true
    }
  }

  // Sort: connected platforms first, then available, then planned
  return [...map.values()].sort((a, b) => {
    const scoreA = a.connected.length > 0 ? 2 : a.available.length > 0 ? 1 : 0
    const scoreB = b.connected.length > 0 ? 2 : b.available.length > 0 ? 1 : 0
    return scoreB - scoreA
  })
}

export default function SurfacesPage() {
  const { data: surfaces, loading: surfacesLoading } = useApi<Surface[]>('/api/surfaces')
  const { data: harnesses } = useApi<Harness[]>('/api/harnesses')

  function harnessName(id: string): string {
    return harnesses?.find((h) => h.id === id)?.name ?? id
  }

  const groups = surfaces ? groupByPlatform(surfaces) : []
  const connectedCount = groups.reduce((n, g) => n + g.connected.length, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Surfaces</h2>
        {surfaces && (
          <span className="text-sm text-muted-foreground">
            {connectedCount} connected across {groups.filter((g) => g.connected.length > 0).length} platforms
          </span>
        )}
      </div>

      {surfacesLoading && <p className="text-muted-foreground">Loading...</p>}

      {!surfacesLoading && surfaces && groups.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <Plug className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">No surfaces configured yet.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Connect a messaging platform from a harness's Surfaces tab.
          </p>
        </div>
      )}

      {!surfacesLoading && groups.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => {
            const Icon = group.icon
            const hasConnections = group.connected.length > 0
            const statusLabel = hasConnections
              ? `${group.connected.length} connection${group.connected.length > 1 ? 's' : ''}`
              : group.available.length > 0
                ? 'Available'
                : 'Planned'
            const statusType = hasConnections ? 'running' : group.available.length > 0 ? 'idle' : 'stopped'

            return (
              <div
                key={group.platform}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 flex flex-col gap-3"
              >
                {/* Header */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-muted">
                    <Icon className="h-4.5 w-4.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{group.label}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <StatusDot status={statusType as HarnessStatus} />
                      <span className="text-xs text-muted-foreground">{statusLabel}</span>
                    </div>
                  </div>
                </div>

                {/* Connected harnesses */}
                {hasConnections && (
                  <div className="space-y-2">
                    {group.connected.map((s) => (
                      <div key={s.id} className="text-xs border border-[var(--border)] rounded-lg px-3 py-2 bg-muted/20">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">
                            {s.harnessIds.map(harnessName).join(', ')}
                          </span>
                          <span className="text-[var(--success)] text-[10px] font-medium uppercase tracking-wide">Connected</span>
                        </div>
                        {Object.entries(s.config).filter(([, v]) => v).length > 0 && (
                          <div className="mt-1.5 space-y-0.5 text-muted-foreground">
                            {Object.entries(s.config)
                              .filter(([, v]) => v)
                              .map(([key, val]) => (
                                <div key={key} className="flex gap-1.5">
                                  <span className="capitalize">{key}:</span>
                                  <span className="font-mono truncate">{val}</span>
                                </div>
                              ))}
                          </div>
                        )}
                        {s.harnessIds.length > 0 && (
                          <div className="mt-2">
                            <Link
                              href={`/harnesses/${s.harnessIds[0]}`}
                              className="text-[10px] text-accent-foreground hover:underline"
                            >
                              Configure in harness →
                            </Link>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty state for card */}
                {!hasConnections && (
                  <div className="text-xs text-muted-foreground">
                    {group.planned
                      ? 'Integration planned — not yet implemented.'
                      : 'Available for connection. Configure from a harness.'}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
