'use client'

import { useApi } from '@/lib/hooks/use-api'
import type { Person } from '@/lib/types'

export default function PermissionsPage() {
  const { data: people, loading } = useApi<Person[]>('/api/people')

  const admins = people?.filter((p) => p.role === 'admin') ?? []
  const community = people?.filter((p) => p.role === 'community') ?? []

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-6">Permissions</h2>

      {loading && <p className="text-muted-foreground">Loading...</p>}

      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              Admins
              <span className="text-xs text-muted-foreground font-normal">({admins.length})</span>
            </h3>
            {admins.length > 0 ? (
              <ul className="space-y-2">
                {admins.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span className="inline-block h-6 w-6 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-xs font-medium text-[var(--accent)]">
                      {p.handle.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm">@{p.handle}</span>
                    {p.surfaces.length > 0 && (
                      <span className="text-xs text-muted-foreground ml-auto">{p.surfaces.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No admins configured.</p>
            )}
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="font-medium mb-3 flex items-center gap-2">
              Community
              <span className="text-xs text-muted-foreground font-normal">({community.length})</span>
            </h3>
            {community.length > 0 ? (
              <ul className="space-y-2">
                {community.map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span className="inline-block h-6 w-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                      {p.handle.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm">@{p.handle}</span>
                    {p.surfaces.length > 0 && (
                      <span className="text-xs text-muted-foreground ml-auto">{p.surfaces.join(', ')}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No community members configured.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
