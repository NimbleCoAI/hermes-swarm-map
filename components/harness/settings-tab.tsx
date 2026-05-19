// components/harness/settings-tab.tsx
'use client'

import { useState, useEffect } from 'react'
import { Shield, Loader2, Save, RotateCw, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { TagInput } from '@/components/ui/tag-input'
import type { Surface } from '@/lib/types'

type PairingUser = {
  userId: string
  userName: string
  approvedAt: number
  platform: string
}

type SurfaceSettings = {
  allowedUsers: string[]
  allowedGroups: string[]
  adminUsers: string[]
  allowAll: boolean
}

type Settings = {
  dmPolicy: 'approved-only' | 'allow-all'
  groupInvitePolicy: 'approved-only' | 'allow-all'
  surfaces: Record<string, SurfaceSettings>
}

type Props = {
  harnessId: string
  connectedSurfaces: Surface[]
}

const PLATFORM_LABELS: Record<string, { users: string; groups: string }> = {
  signal: { users: 'Phone numbers (E.164)', groups: 'Group IDs' },
  telegram: { users: 'User IDs', groups: 'Chat IDs' },
  mattermost: { users: 'Usernames', groups: 'Channel names' },
}

export function SettingsTab({ harnessId, connectedSurfaces }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [discovering, setDiscovering] = useState<string | null>(null)
  const [discoveredGroups, setDiscoveredGroups] = useState<Array<{id: string; name: string}>>([])
  const [pairedUsers, setPairedUsers] = useState<PairingUser[]>([])

  useEffect(() => {
    fetch(`/api/harnesses/${harnessId}/pairing`)
      .then(res => res.json())
      .then(data => { if (data.users) setPairedUsers(data.users) })
      .catch(() => {})
  }, [harnessId])

  async function revokePairing(platform: string, userId: string) {
    if (!window.confirm(`Revoke access for ${userId}?`)) return
    try {
      const res = await fetch(`/api/harnesses/${harnessId}/pairing`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, userId }),
      })
      if (res.ok) {
        setPairedUsers(prev => prev.filter(u => !(u.platform === platform && u.userId === userId)))
        toast.success('Access revoked')
      } else {
        toast.error('Failed to revoke')
      }
    } catch {
      toast.error('Network error')
    }
  }

  useEffect(() => {
    fetch(`/api/harnesses/${harnessId}/settings`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setSettings(data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [harnessId])

  function updateSurface(platform: string, field: keyof SurfaceSettings, value: string[] | boolean) {
    if (!settings) return
    setSettings({
      ...settings,
      surfaces: {
        ...settings.surfaces,
        [platform]: { ...settings.surfaces[platform], [field]: value },
      },
    })
    setDirty(true)
    setSaved(false)
  }

  function updateDmPolicy(policy: 'approved-only' | 'allow-all') {
    if (!settings) return
    setSettings({ ...settings, dmPolicy: policy })
    setDirty(true)
    setSaved(false)
  }

  function updateGroupInvitePolicy(policy: 'approved-only' | 'allow-all') {
    if (!settings) return
    setSettings({ ...settings, groupInvitePolicy: policy })
    setDirty(true)
    setSaved(false)
  }

  async function handleSave() {
    if (!settings) return
    setSaving(true)
    try {
      const res = await fetch(`/api/harnesses/${harnessId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (data.success) {
        // Auto-restart with rebuild mode so the container picks up .env changes
        toast.success('Settings saved. Restarting agent...')
        setDirty(false)
        setSaved(false)
        setRestarting(true)
        try {
          const restartRes = await fetch(`/api/harnesses/${harnessId}/restart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'rebuild' }),
          })
          if (restartRes.ok) {
            toast.success('Agent restarted with new settings')
          } else {
            const restartData = await restartRes.json()
            toast.error(restartData.error || 'Restart failed — restart manually')
            setSaved(true) // Show manual restart button as fallback
          }
        } catch {
          toast.error('Restart failed — restart manually')
          setSaved(true)
        } finally {
          setRestarting(false)
        }
      } else {
        toast.error(data.error || 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleRestart() {
    setRestarting(true)
    try {
      const res = await fetch(`/api/harnesses/${harnessId}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'rebuild' }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Harness restarted')
        setSaved(false)
      } else {
        toast.error(data.error || 'Restart failed')
      }
    } catch {
      toast.error('Restart failed')
    } finally {
      setRestarting(false)
    }
  }

  async function discoverGroups(platform: string) {
    setDiscovering(platform)
    setDiscoveredGroups([])
    try {
      let url = ''
      if (platform === 'signal') {
        const surfaceInfo = connectedSurfaces.find(s => s.platform.toLowerCase() === 'signal')
        const phone = surfaceInfo?.config?.phone
        if (!phone) { toast.error('No Signal phone configured'); return }
        url = `/api/surfaces/signal/groups?phone=${encodeURIComponent(phone)}`
      } else if (platform === 'mattermost') {
        const surfaceInfo = connectedSurfaces.find(s => s.platform.toLowerCase() === 'mattermost')
        const mmUrl = surfaceInfo?.config?.url
        if (!mmUrl) { toast.error('No Mattermost URL configured'); return }
        url = `/api/surfaces/mattermost/channels?url=${encodeURIComponent(mmUrl)}&token=from-env`
      }
      const res = await fetch(url)
      const data = await res.json()
      setDiscoveredGroups(data.groups || data.channels || [])
    } catch {
      toast.error('Failed to discover groups')
    } finally {
      setDiscovering(null)
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading settings...</p>
  }

  if (!settings) {
    return <p className="text-sm text-muted-foreground">No .env found for this harness.</p>
  }

  const activePlatforms = connectedSurfaces.map(s => s.platform.toLowerCase())

  return (
    <div className="space-y-6">
      {/* DM Policy */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">DM Access Policy</h3>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="dmPolicy"
              checked={settings.dmPolicy === 'approved-only'}
              onChange={() => updateDmPolicy('approved-only')}
              className="accent-[var(--accent)]"
            />
            Approved users only
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="dmPolicy"
              checked={settings.dmPolicy === 'allow-all'}
              onChange={() => updateDmPolicy('allow-all')}
              className="accent-[var(--accent)]"
            />
            Allow all
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {settings.dmPolicy === 'approved-only'
            ? 'Only users in the approved list below can DM this agent.'
            : 'Anyone can DM this agent. Approved users list still controls who can add this agent to groups.'}
        </p>
      </div>

      {/* Group Invite Policy */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">Group Invite Policy</h3>
        </div>
        <div className="flex gap-3">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="groupInvitePolicy"
              checked={settings.groupInvitePolicy === 'approved-only'}
              onChange={() => updateGroupInvitePolicy('approved-only')}
              className="accent-[var(--accent)]"
            />
            Approved users only
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="radio"
              name="groupInvitePolicy"
              checked={settings.groupInvitePolicy === 'allow-all'}
              onChange={() => updateGroupInvitePolicy('allow-all')}
              className="accent-[var(--accent)]"
            />
            Allow all
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {settings.groupInvitePolicy === 'approved-only'
            ? 'Only approved users can add this agent to groups.'
            : 'Anyone can add this agent to groups.'}
        </p>
      </div>

      {/* Per-surface cards */}
      {activePlatforms.map(platform => {
        const surf = settings.surfaces[platform]
        if (!surf) return null
        const labels = PLATFORM_LABELS[platform] || { users: 'Users', groups: 'Groups' }
        const surfaceInfo = connectedSurfaces.find(s => s.platform.toLowerCase() === platform)

        return (
          <div key={platform} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm capitalize">{platform}</h3>
              {surfaceInfo?.config?.phone && (
                <span className="text-xs font-mono text-muted-foreground">{surfaceInfo.config.phone}</span>
              )}
              {surfaceInfo?.config?.url && (
                <span className="text-xs font-mono text-muted-foreground">{surfaceInfo.config.url}</span>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Approved Users ({labels.users})</label>
              <TagInput
                values={surf.allowedUsers}
                onChange={(v) => updateSurface(platform, 'allowedUsers', v)}
                placeholder={`Add ${labels.users.toLowerCase()}...`}
              />
              <p className="text-xs text-muted-foreground">Controls who can DM this agent and add it to groups</p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Approved {labels.groups}</label>
              <TagInput
                values={surf.allowedGroups}
                onChange={(v) => updateSurface(platform, 'allowedGroups', v)}
                placeholder={`Add ${labels.groups.toLowerCase()}...`}
              />
              <p className="text-xs text-muted-foreground">Leave empty + use * for all groups</p>
              {(platform === 'signal' || platform === 'mattermost') && (
                <div className="space-y-2 pt-1">
                  <button
                    onClick={() => discoverGroups(platform)}
                    disabled={discovering === platform}
                    className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                  >
                    {discovering === platform ? 'Discovering...' : 'Discover existing groups →'}
                  </button>
                  {discoveredGroups.length > 0 && discovering === null && (
                    <div className="flex flex-wrap gap-1">
                      {discoveredGroups
                        .filter(g => !surf.allowedGroups.includes(g.id))
                        .map(g => (
                          <button
                            key={g.id}
                            onClick={() => {
                              updateSurface(platform, 'allowedGroups', [...surf.allowedGroups, g.id])
                              setDiscoveredGroups(prev => prev.filter(x => x.id !== g.id))
                            }}
                            className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20"
                          >
                            + {g.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {platform === 'mattermost' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Admin Users</label>
                <TagInput
                  values={surf.adminUsers}
                  onChange={(v) => updateSurface(platform, 'adminUsers', v)}
                  placeholder="Add admin usernames..."
                />
              </div>
            )}

            {platform !== 'mattermost' && (
              <p className="text-xs text-muted-foreground italic">Admin roles not enforced on {platform} yet.</p>
            )}

            {/* Paired users (dynamic approvals) */}
            {pairedUsers.filter(u => u.platform === platform).length > 0 && (
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <div className="flex items-center gap-2">
                  <Users className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Dynamically paired users</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pairedUsers
                    .filter(u => u.platform === platform)
                    .map(u => (
                      <span
                        key={u.userId}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                      >
                        {u.userName || u.userId}
                        <button
                          onClick={() => revokePairing(platform, u.userId)}
                          className="hover:text-red-500 transition-colors"
                          title="Revoke access"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  These users were approved via pairing. Click × to revoke.
                </p>
              </div>
            )}
          </div>
        )
      })}

      {activePlatforms.length === 0 && (
        <p className="text-sm text-muted-foreground">No surfaces connected. Connect a surface first to configure access.</p>
      )}

      {/* Save + Restart buttons */}
      {(dirty || saved) && (
        <div className="flex justify-end gap-2">
          {dirty && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Settings
            </button>
          )}
          {saved && !dirty && (
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
            >
              {restarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
              Restart to apply
            </button>
          )}
        </div>
      )}
    </div>
  )
}
