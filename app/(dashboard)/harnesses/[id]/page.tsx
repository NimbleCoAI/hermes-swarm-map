'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useApi } from '@/lib/hooks/use-api'
import { StatusDot } from '@/components/shared/status-dot'
import { TierBadge } from '@/components/shared/tier-badge'
import { TierSelect } from '@/components/shared/tier-select'
import { CacheStatePill } from '@/components/shared/cache-state-pill'
import { Button } from '@/components/ui/button'
import { SplitButton } from '@/components/shared/split-button'
import { RiskBar } from '@/components/shared/risk-bar'
import { TierMix } from '@/components/shared/tier-mix'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Harness, HabitatTier, Tool, Key, MemoryScope, Surface } from '@/lib/types'
import { SignalSetupDialog } from '@/components/surfaces/signal-setup-dialog'
import { TelegramSetupDialog } from '@/components/surfaces/telegram-setup-dialog'
import { MattermostSetupDialog } from '@/components/surfaces/mattermost-setup-dialog'
import { EditSurfaceDialog } from '@/components/surfaces/edit-surface-dialog'
import { SettingsTab } from '@/components/harness/settings-tab'
import { toast } from 'sonner'
import { MessageSquare, Globe, Bot, Hash, Pencil, ChevronDown, ChevronRight, Shield, Loader2, Save, RotateCw, Users, X } from 'lucide-react'
import { TagInput } from '@/components/ui/tag-input'
import { Switch } from '@/components/ui/switch'
import { TIER_LABELS } from '@/lib/constants'

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
  surfaces: Record<string, SurfaceSettings>
}

const PLATFORM_LABELS: Record<string, { users: string; groups: string }> = {
  signal: { users: 'Phone numbers (E.164)', groups: 'Group IDs' },
  telegram: { users: 'User IDs', groups: 'Chat IDs' },
  mattermost: { users: 'User IDs', groups: 'Channel IDs' },
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  telegram: <MessageSquare className="h-4 w-4" />,
  mattermost: <Hash className="h-4 w-4" />,
  slack: <Hash className="h-4 w-4" />,
  web: <Globe className="h-4 w-4" />,
  api: <Bot className="h-4 w-4" />,
  discord: <MessageSquare className="h-4 w-4" />,
  signal: <MessageSquare className="h-4 w-4" />,
}

const SURFACE_STATUS_STYLES: Record<Surface['status'], string> = {
  connected: 'bg-[var(--success)]/10 text-[var(--success)]',
  available: 'bg-muted text-muted-foreground',
  planned: 'bg-[var(--warning)]/10 text-[var(--warning)]',
}

const MODEL_PROVIDERS = ['anthropic', 'openrouter', 'ollama', 'custom', 'gemini', 'nous', 'bedrock'] as const

type FallbackProviderEntry = { provider: string; model: string; base_url?: string }

type ModelConfig = { provider: string; primary: string; models: string[]; fallbackProviders?: FallbackProviderEntry[] }

type LogsResponse = { logs: string; lines: number }

type UsageByModel = {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  cost: number
  sessionCount: number
  costStatus: 'estimated' | 'unknown'
}

type UsageSession = {
  sessionId: string
  model: string
  startedAt: number
  endedAt: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  estimatedCostUsd: number
  costStatus: 'estimated' | 'unknown'
}

type UsageData = {
  costToday: number
  costWeek: number
  costMonth: number
  totalTokensToday: number
  sessionCountToday: number
  costStatus: 'estimated' | 'partial' | 'unknown'
  byModel: UsageByModel[]
  recentSessions: UsageSession[]
}

export default function HarnessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const { data: harness, loading, refetch } = useApi<Harness>(`/api/harnesses/${id}`)
  const { data: tools } = useApi<Tool[]>('/api/tools')
  const { data: keys } = useApi<Key[]>('/api/keys')
  const { data: memoryScopes } = useApi<MemoryScope[]>('/api/memory-scopes')
  const { data: surfaces, refetch: refetchSurfaces } = useApi<Surface[]>('/api/surfaces')
  const { data: modelConfig, refetch: refetchModels } = useApi<ModelConfig>(`/api/harnesses/${id}/models`)
  const { data: usageData } = useApi<UsageData>(`/api/harnesses/${id}/usage`)

  const [connectDialog, setConnectDialog] = useState<string | null>(null)
  const [editSurface, setEditSurface] = useState<Surface | null>(null)
  const [tierOverride, setTierOverride] = useState<HabitatTier | null>(null)

  // Model edit state
  const [modelProvider, setModelProvider] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelSaving, setModelSaving] = useState(false)

  // Surface settings state
  const [surfaceSettings, setSurfaceSettings] = useState<Settings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  const [settingsRestarting, setSettingsRestarting] = useState(false)
  const [discovering, setDiscovering] = useState<string | null>(null)
  const [discoveredGroups, setDiscoveredGroups] = useState<Array<{id: string; name: string}>>([])
  const [pairedUsers, setPairedUsers] = useState<PairingUser[]>([])
  const [expandedSettings, setExpandedSettings] = useState<Record<string, boolean>>({})

  // Tool toggle state
  const [toolsSaving, setToolsSaving] = useState(false)

  async function toggleTool(toolId: string, enabled: boolean) {
    if (!harness) return
    const current = new Set(harness.tools)
    if (enabled) {
      current.add(toolId)
    } else {
      current.delete(toolId)
    }
    const newTools = Array.from(current)
    setToolsSaving(true)
    try {
      const res = await fetch(`/api/harnesses/${id}/tools`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tools: newTools }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to update tools')
        return
      }
      refetch()
      toast.success(enabled ? 'Tool enabled' : 'Tool disabled')
    } catch {
      toast.error('Failed to update tools')
    } finally {
      setToolsSaving(false)
    }
  }

  useEffect(() => {
    fetch(`/api/harnesses/${id}/settings`)
      .then(res => res.json())
      .then(data => {
        if (!data.error) setSurfaceSettings(data)
        setSettingsLoading(false)
      })
      .catch(() => setSettingsLoading(false))
  }, [id])

  useEffect(() => {
    fetch(`/api/harnesses/${id}/pairing`)
      .then(res => res.json())
      .then(data => { if (data.users) setPairedUsers(data.users) })
      .catch(() => {})
  }, [id])

  function updateSurfaceSetting(platform: string, field: keyof SurfaceSettings, value: string[] | boolean) {
    if (!surfaceSettings) return
    setSurfaceSettings({
      ...surfaceSettings,
      surfaces: {
        ...surfaceSettings.surfaces,
        [platform]: { ...surfaceSettings.surfaces[platform], [field]: value },
      },
    })
    setSettingsDirty(true)
    setSettingsSaved(false)
  }

  function updateDmPolicy(policy: 'approved-only' | 'allow-all') {
    if (!surfaceSettings) return
    setSurfaceSettings({ ...surfaceSettings, dmPolicy: policy })
    setSettingsDirty(true)
    setSettingsSaved(false)
  }

  async function handleSettingsSave() {
    if (!surfaceSettings) return
    setSettingsSaving(true)
    try {
      const res = await fetch(`/api/harnesses/${id}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(surfaceSettings),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Settings saved. Restarting agent...')
        setSettingsDirty(false)
        setSettingsSaved(false)
        setSettingsRestarting(true)
        try {
          const restartRes = await fetch(`/api/harnesses/${id}/restart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: 'rebuild' }),
          })
          if (restartRes.ok) {
            toast.success('Agent restarted with new settings')
            refetch()
          } else {
            const restartData = await restartRes.json()
            toast.error(restartData.error || 'Restart failed — restart manually')
            setSettingsSaved(true)
          }
        } catch {
          toast.error('Restart failed — restart manually')
          setSettingsSaved(true)
        } finally {
          setSettingsRestarting(false)
        }
      } else {
        toast.error(data.error || 'Failed to save')
      }
    } catch {
      toast.error('Network error')
    } finally {
      setSettingsSaving(false)
    }
  }

  async function handleSettingsRestart() {
    setSettingsRestarting(true)
    try {
      const res = await fetch(`/api/harnesses/${id}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'rebuild' }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success('Harness restarted')
        setSettingsSaved(false)
        refetch()
      } else {
        toast.error(data.error || 'Restart failed')
      }
    } catch {
      toast.error('Restart failed')
    } finally {
      setSettingsRestarting(false)
    }
  }

  async function revokePairing(platform: string, userId: string) {
    if (!window.confirm(`Revoke access for ${userId}?`)) return
    try {
      const res = await fetch(`/api/harnesses/${id}/pairing`, {
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

  async function discoverGroups(platform: string, connSurfaces: Surface[]) {
    setDiscovering(platform)
    setDiscoveredGroups([])
    try {
      let url = ''
      if (platform === 'signal') {
        const surfaceInfo = connSurfaces.find(s => s.platform.toLowerCase() === 'signal')
        const phone = surfaceInfo?.config?.phone
        if (!phone) { toast.error('No Signal phone configured'); return }
        url = `/api/surfaces/signal/groups?phone=${encodeURIComponent(phone)}`
      } else if (platform === 'mattermost') {
        const surfaceInfo = connSurfaces.find(s => s.platform.toLowerCase() === 'mattermost')
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

  const [logLines, setLogLines] = useState(100)
  const { data: logsData, loading: logsLoading, refetch: refetchLogs } = useApi<LogsResponse>(
    `/api/harnesses/${id}/logs?lines=${logLines}`
  )

  async function doRestart(mode: string) {
    try {
      const res = await fetch(`/api/harnesses/${id}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success(`Harness restarted (${mode})`)
      refetch()
    } catch {
      toast.error('Restart failed')
    }
  }

  async function doDuplicate() {
    const newName = window.prompt('Name for the duplicate harness:')
    if (!newName) return
    try {
      const res = await fetch(`/api/harnesses/${id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Duplicate failed')
        return
      }
      toast.success(`Duplicated as "${newName}"`)
      router.push('/harnesses')
    } catch {
      toast.error('Duplicate failed')
    }
  }

  async function saveModelConfig() {
    const provider = modelProvider || modelConfig?.provider || ''
    const model = modelName || modelConfig?.primary || ''
    if (!provider || !model) {
      toast.error('Provider and model are required')
      return
    }
    setModelSaving(true)
    try {
      const res = await fetch(`/api/harnesses/${id}/models`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to save model config')
        return
      }
      toast.success('Model config saved')
      setModelProvider('')
      setModelName('')
      refetchModels()
    } catch {
      toast.error('Failed to save model config')
    } finally {
      setModelSaving(false)
    }
  }

  if (loading) return <p className="text-muted-foreground">Loading...</p>
  if (!harness) return <p className="text-destructive">Harness not found.</p>

  const harnessTools = tools?.filter((t) => harness.tools.includes(t.id)) ?? []
  const allTools = tools ?? []
  const harnessKeys = keys?.filter((k) => k.assignedTo.includes(harness.id)) ?? []
  const harnessMemory = memoryScopes?.filter((m) => m.members.includes(harness.id)) ?? []
  const connectedSurfaces = surfaces?.filter((s) => s.harnessIds.includes(harness.id)) ?? []
  const connectedPlatforms = new Set(connectedSurfaces.map((s) => s.platform))
  const otherSurfaces = surfaces?.filter((s) =>
    !s.harnessIds.includes(harness.id) &&
    (s.status === 'available' || s.status === 'planned') &&
    !connectedPlatforms.has(s.platform)
  ) ?? []

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <StatusDot status={harness.status} />
          <div>
            <h2 className="text-2xl font-semibold">{harness.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <TierSelect
                harnessId={harness.id}
                currentTier={tierOverride ?? harness.tier}
                tools={harnessTools}
                onTierChanged={(newTier) => setTierOverride(newTier)}
              />
              <span className="text-sm text-muted-foreground">{harness.persona}</span>
              {harness.cacheState && (
                <CacheStatePill state={harness.cacheState} age={harness.cacheAge} />
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={doDuplicate}>
            Duplicate
          </Button>
          <SplitButton
            label="Quick Restart"
            onClick={() => doRestart('quick')}
            disabled={harness.status === 'stopped'}
            items={[
              { label: 'Rebuild', description: 'Rebuild container', onClick: () => doRestart('rebuild') },
              { label: 'Purge & Restart', description: 'Clear cache and restart', onClick: () => doRestart('purge') },
            ]}
          />
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="tools">Tools ({harnessTools.length}/{allTools.length})</TabsTrigger>
          <TabsTrigger value="surfaces">Surfaces ({connectedSurfaces.length})</TabsTrigger>
          <TabsTrigger value="keys">Keys ({harnessKeys.length})</TabsTrigger>
          <TabsTrigger value="memory">Memory ({harnessMemory.length})</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <h3 className="font-medium text-sm">Runtime</h3>
              <Row label="Runtime" value={harness.runtime} />
              <Row label="Platform" value={`${harness.platform} / ${harness.channel}`} />
              <Row label="Status" value={harness.status} />
              <Row label="Models" value={harness.models.join(', ')} />
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
              <h3 className="font-medium text-sm">Usage</h3>
              <Row label="Sessions today" value={usageData?.sessionCountToday ?? 0} />
              <Row label="Cost today" value={`${usageData?.costStatus === 'estimated' ? '~' : ''}$${(usageData?.costToday ?? harness.costToday).toFixed(2)}`} />
              <Row label="Cost this week" value={`${usageData?.costStatus === 'estimated' ? '~' : ''}$${(usageData?.costWeek ?? 0).toFixed(2)}`} />
              <Row label="Cost this month" value={`${usageData?.costStatus === 'estimated' ? '~' : ''}$${(usageData?.costMonth ?? 0).toFixed(2)}`} />
              <Row label="CPU" value={`${harness.cpu}%`} />
              <Row label="Memory" value={`${harness.mem}%`} />
            </div>
            {harness.health.errors > 0 && (
              <div className="col-span-2 rounded-xl border border-[var(--danger)] bg-[var(--danger)]/5 p-4">
                <p className="text-sm font-medium text-destructive">{harness.health.errors} error(s)</p>
                {harness.health.errorMsg && (
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{harness.health.errorMsg}</p>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <div className="space-y-4">
            {/* Cost summary cards */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Today</p>
                <p className="text-2xl font-semibold mt-1">
                  {usageData?.costStatus === 'estimated' ? '~' : ''}${(usageData?.costToday ?? 0).toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{usageData?.sessionCountToday ?? 0} sessions</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">This Week</p>
                <p className="text-2xl font-semibold mt-1">
                  {usageData?.costStatus === 'estimated' ? '~' : ''}${(usageData?.costWeek ?? 0).toFixed(2)}
                </p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">This Month</p>
                <p className="text-2xl font-semibold mt-1">
                  {usageData?.costStatus === 'estimated' ? '~' : ''}${(usageData?.costMonth ?? 0).toFixed(2)}
                </p>
              </div>
            </div>

            {/* Per-model breakdown */}
            {usageData && usageData.byModel.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border)]">
                  <h3 className="font-medium text-sm">Cost by Model (Today)</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Model</th>
                      <th className="text-right px-4 py-2">Input</th>
                      <th className="text-right px-4 py-2">Output</th>
                      <th className="text-right px-4 py-2">Cache R</th>
                      <th className="text-right px-4 py-2">Cache W</th>
                      <th className="text-right px-4 py-2">Sessions</th>
                      <th className="text-right px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.byModel.map((m) => (
                      <tr key={m.model} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2 font-mono text-xs">{m.model}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(m.inputTokens)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(m.outputTokens)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(m.cacheReadTokens)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{formatTokens(m.cacheWriteTokens)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{m.sessionCount}</td>
                        <td className="px-4 py-2 text-right font-medium">
                          {m.costStatus === 'estimated' ? '~' : ''}${m.cost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Recent sessions */}
            {usageData && usageData.recentSessions.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                <div className="p-4 border-b border-[var(--border)]">
                  <h3 className="font-medium text-sm">Recent Sessions</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                      <th className="text-left px-4 py-2">Time</th>
                      <th className="text-left px-4 py-2">Model</th>
                      <th className="text-right px-4 py-2">Tokens</th>
                      <th className="text-right px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usageData.recentSessions.map((s) => (
                      <tr key={s.sessionId} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-4 py-2 text-xs text-muted-foreground">
                          {new Date(s.startedAt * 1000).toLocaleString()}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{s.model}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">
                          {formatTokens(s.inputTokens + s.outputTokens + s.cacheReadTokens + s.cacheWriteTokens + s.reasoningTokens)}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {s.costStatus === 'estimated' ? '~' : ''}${s.estimatedCostUsd.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!usageData && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
                <p className="text-sm text-muted-foreground">No usage data available. The agent may not have a state.db yet.</p>
              </div>
            )}

            {usageData?.costStatus && (
              <p className="text-xs text-muted-foreground">
                {usageData.costStatus === 'estimated' && 'Costs are estimates based on published model pricing.'}
                {usageData.costStatus === 'partial' && 'Some models have unknown pricing. Costs are partially estimated.'}
                {usageData.costStatus === 'unknown' && 'Model pricing not available. Token counts are shown but costs cannot be estimated.'}
              </p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="models" className="mt-4">
          <ModelCascadeEditor
            models={modelConfig?.models ?? harness.models ?? []}
            provider={modelConfig?.provider ?? ''}
            fallbackProviders={modelConfig?.fallbackProviders ?? []}
            harnessId={id}
            onSave={async (entries) => {
              setModelSaving(true)
              try {
                const res = await fetch(`/api/harnesses/${id}/models`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ fallback_providers: entries }),
                })
                if (!res.ok) { toast.error('Failed to save'); return }
                toast.success('Model cascade saved')
                refetchModels()
              } catch { toast.error('Failed to save') }
              finally { setModelSaving(false) }
            }}
            saving={modelSaving}
          />
        </TabsContent>

        <TabsContent value="surfaces" className="mt-4">
          <div className="space-y-4">
            {/* Connected surfaces with inline settings */}
            {connectedSurfaces.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Connected</h3>
                {connectedSurfaces.map((s) => {
                  const platform = s.platform.toLowerCase()
                  const surf = surfaceSettings?.surfaces[platform]
                  const labels = PLATFORM_LABELS[platform] || { users: 'Users', groups: 'Groups' }
                  const isExpanded = expandedSettings[s.id] ?? false
                  const platformPairedUsers = pairedUsers.filter(u => u.platform === platform)

                  return (
                    <div key={s.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                      {/* Surface header row */}
                      <div className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <span className="text-muted-foreground">
                            {PLATFORM_ICONS[platform] ?? <Globe className="h-4 w-4" />}
                          </span>
                          <div>
                            <p className="font-medium text-sm">{s.name}</p>
                            <p className="text-xs text-muted-foreground capitalize">{s.platform}</p>
                            {s.config.url && (
                              <p className="text-xs font-mono text-muted-foreground">{s.config.url}</p>
                            )}
                            {s.config.phone && (
                              <p className="text-xs font-mono text-muted-foreground">{s.config.phone}</p>
                            )}
                            {s.config.profileName && (
                              <p className="text-xs text-muted-foreground italic">{s.config.profileName}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SURFACE_STATUS_STYLES[s.status]}`}>
                            {s.status}
                          </span>
                          {surf && (
                            <button
                              onClick={() => setExpandedSettings(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                              className="text-xs px-2 py-1 rounded-md border border-[var(--border)] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1"
                              title="Surface settings"
                            >
                              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                              <span>Settings</span>
                            </button>
                          )}
                          <button
                            onClick={() => setEditSurface(s)}
                            className="text-xs px-2 py-1 rounded-md border border-[var(--border)] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            title="Edit config"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!window.confirm(`Disconnect ${s.name}? This will remove its configuration.`)) return
                              try {
                                const res = await fetch(`/api/harnesses/${id}/surfaces/disconnect`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ platform }),
                                })
                                if (!res.ok) throw new Error('Failed')
                                toast.success(`${s.name} disconnected`)
                                refetchSurfaces()
                              } catch {
                                toast.error(`Failed to disconnect ${s.name}`)
                              }
                            }}
                            className="text-xs px-2 py-1 rounded-md border border-red-500/50 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
                          >
                            Disconnect
                          </button>
                        </div>
                      </div>

                      {/* Expandable settings section */}
                      {isExpanded && surf && (
                        <div className="border-t border-[var(--border)] p-4 space-y-4 bg-[var(--bg)]/50">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Admins ({labels.users})</label>
                            <TagInput
                              values={surf.allowedUsers}
                              onChange={(v) => updateSurfaceSetting(platform, 'allowedUsers', v)}
                              placeholder={`Add ${labels.users.toLowerCase()}...`}
                              renderTag={(value) => {
                                const resolved = (surf as any).resolvedUsers?.find(
                                  (r: any) => r.display === value || r.nativeId === value
                                )
                                return resolved?.profileName
                                  ? `${value} (${resolved.profileName})`
                                  : value
                              }}
                            />
                            <p className="text-xs text-muted-foreground">
                              Admins can DM, add bot to groups, approve commands, and access global memory.
                            </p>
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Approved {labels.groups}</label>
                            <TagInput
                              values={surf.allowedGroups}
                              onChange={(v) => updateSurfaceSetting(platform, 'allowedGroups', v)}
                              placeholder={`Add ${labels.groups.toLowerCase()}...`}
                            />
                            <p className="text-xs text-muted-foreground">Leave empty + use * for all groups</p>
                            {(platform === 'signal' || platform === 'mattermost') && (
                              <div className="space-y-2 pt-1">
                                <button
                                  onClick={() => discoverGroups(platform, connectedSurfaces)}
                                  disabled={discovering === platform}
                                  className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
                                >
                                  {discovering === platform ? 'Discovering...' : 'Discover existing groups \u2192'}
                                </button>
                                {discoveredGroups.length > 0 && discovering === null && (
                                  <div className="flex flex-wrap gap-1">
                                    {discoveredGroups
                                      .filter(g => !surf.allowedGroups.includes(g.id))
                                      .map(g => (
                                        <button
                                          key={g.id}
                                          onClick={() => {
                                            updateSurfaceSetting(platform, 'allowedGroups', [...surf.allowedGroups, g.id])
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

                          {/* Paired users (dynamic approvals) */}
                          {platformPairedUsers.length > 0 && (
                            <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                              <div className="flex items-center gap-2">
                                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs font-medium text-muted-foreground">Dynamically paired users</span>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {platformPairedUsers.map(u => (
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
                                These users were approved via pairing. Click x to revoke.
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Other surfaces (grayed out) */}
            {otherSurfaces.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Available</h3>
                {otherSurfaces.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] opacity-60 hover:opacity-100 transition-opacity">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {PLATFORM_ICONS[s.platform.toLowerCase()] ?? <Globe className="h-4 w-4" />}
                      </span>
                      <div>
                        <p className="font-medium text-sm">{s.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{s.platform}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => setConnectDialog(s.platform.toLowerCase())}
                      className="text-xs px-2 py-1 rounded-md border border-[var(--accent)] text-[var(--accent)] opacity-100 hover:bg-[var(--accent)] hover:text-white transition-colors"
                    >
                      Connect
                    </button>
                  </div>
                ))}
              </div>
            )}

            {connectedSurfaces.length === 0 && otherSurfaces.length === 0 && (
              <p className="text-sm text-muted-foreground">No surfaces found.</p>
            )}

            {/* Save + Restart buttons */}
            {(settingsDirty || settingsSaved) && (
              <div className="flex justify-end gap-2">
                {settingsDirty && (
                  <button
                    onClick={handleSettingsSave}
                    disabled={settingsSaving}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-md bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {settingsSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Settings
                  </button>
                )}
                {settingsSaved && !settingsDirty && (
                  <button
                    onClick={handleSettingsRestart}
                    disabled={settingsRestarting}
                    className="flex items-center gap-2 px-4 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-50"
                  >
                    {settingsRestarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
                    Restart to apply
                  </button>
                )}
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="w-12 px-4 py-3">On</th>
                  <th className="text-left px-4 py-3">Tool</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Risk</th>
                  <th className="text-left px-4 py-3">Tiers</th>
                  <th className="text-left px-4 py-3">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {allTools.map((t) => {
                  const enabled = harness.tools.includes(t.id)
                  const tierAllowed = t.allowedTiers.includes(harness.tier)
                  return (
                    <tr key={t.id} className={`border-b border-[var(--border)] last:border-0 ${!tierAllowed ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) => toggleTool(t.id, checked)}
                          disabled={toolsSaving || !tierAllowed}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.description}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{t.source}</td>
                      <td className="px-4 py-3"><RiskBar level={t.risk} /></td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {t.allowedTiers.map((tier) => (
                            <span key={tier} className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              {TIER_LABELS[tier]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={t.reviewed ? 'text-[var(--success)]' : 'text-muted-foreground'}>
                          {t.reviewed ? 'Yes' : 'Pending'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {allTools.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground text-sm">No tools discovered.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="keys" className="mt-4">
          <div className="space-y-2">
            {harnessKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div>
                  <p className="font-medium text-sm">{k.provider}</p>
                  <p className="text-xs font-mono text-muted-foreground">{k.maskedValue}</p>
                </div>
                {k.budgetUsd && (
                  <span className="text-xs text-muted-foreground">${k.budgetUsd}/mo</span>
                )}
              </div>
            ))}
            {harnessKeys.length === 0 && <p className="text-sm text-muted-foreground">No keys assigned.</p>}
          </div>
        </TabsContent>

        <TabsContent value="memory" className="mt-4">
          <div className="space-y-2">
            {harnessMemory.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                <div>
                  <p className="font-medium text-sm">{m.name}</p>
                  <p className="text-xs text-muted-foreground">{m.strategy} · {m.sizeMb.toFixed(1)} MB</p>
                </div>
                <TierBadge tier={m.tier} />
              </div>
            ))}
            {harnessMemory.length === 0 && <p className="text-sm text-muted-foreground">No memory scopes assigned.</p>}
          </div>
        </TabsContent>

        <TabsContent value="environment" className="mt-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
            <h3 className="font-medium text-sm">Compose Config</h3>
            {harness.composeFile && <Row label="Compose file" value={harness.composeFile} mono />}
            {harness.serviceName && <Row label="Service name" value={harness.serviceName} mono />}
            {!harness.composeFile && !harness.serviceName && (
              <p className="text-sm text-muted-foreground">No environment config.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <select
                value={logLines}
                onChange={(e) => setLogLines(Number(e.target.value))}
                className="text-sm border border-[var(--border)] rounded-md px-2 py-1 bg-[var(--surface)]"
              >
                <option value={50}>50 lines</option>
                <option value={100}>100 lines</option>
                <option value={250}>250 lines</option>
              </select>
              <button
                onClick={() => refetchLogs()}
                disabled={logsLoading}
                className="text-sm px-3 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] hover:bg-muted disabled:opacity-50"
              >
                {logsLoading ? 'Loading…' : 'Refresh'}
              </button>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-black/90 overflow-auto max-h-[500px]">
              <pre className="text-xs font-mono text-green-400 p-4 whitespace-pre-wrap">
                {logsData?.logs || (logsLoading ? 'Fetching logs…' : 'No logs available.')}
              </pre>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <SettingsTab harnessId={harness.id} connectedSurfaces={connectedSurfaces} />
        </TabsContent>
      </Tabs>

      <SignalSetupDialog
        open={connectDialog === 'signal'}
        onClose={() => setConnectDialog(null)}
        harnessId={harness.id}
        harnessName={harness.name}
        onConnected={() => refetchSurfaces()}
      />
      <TelegramSetupDialog
        open={connectDialog === 'telegram'}
        onClose={() => setConnectDialog(null)}
        harnessId={harness.id}
        onConnected={() => refetchSurfaces()}
      />
      <MattermostSetupDialog
        open={connectDialog === 'mattermost'}
        onClose={() => setConnectDialog(null)}
        harnessId={harness.id}
        onConnected={() => refetchSurfaces()}
      />
      {editSurface && (
        <EditSurfaceDialog
          platform={editSurface.platform}
          harnessId={harness.id}
          currentConfig={editSurface.config}
          open={!!editSurface}
          onClose={() => setEditSurface(null)}
          onSaved={() => refetchSurfaces()}
        />
      )}
    </div>
  )
}

function ModelCascadeEditor({
  models: initialModels,
  provider: initialProvider,
  fallbackProviders: initialFallbackProviders,
  onSave,
  saving,
  harnessId,
}: {
  models: string[]
  provider: string
  fallbackProviders: FallbackProviderEntry[]
  onSave: (entries: FallbackProviderEntry[]) => void
  saving: boolean
  harnessId: string
}) {
  // Build initial cascade from fallbackProviders if available, else from models
  function buildInitialCascade(): FallbackProviderEntry[] {
    if (initialFallbackProviders.length > 0) {
      return initialFallbackProviders.map((fp) => ({
        provider: fp.provider,
        model: fp.model,
        ...(fp.base_url ? { base_url: fp.base_url } : {}),
      }))
    }
    // Fallback: convert string models to entries using the provider
    return initialModels.map((m) => ({
      provider: initialProvider || 'anthropic',
      model: m,
    }))
  }

  const [cascade, setCascade] = useState<FallbackProviderEntry[]>(buildInitialCascade)
  const [newModel, setNewModel] = useState('')
  const [newProvider, setNewProvider] = useState<string>('anthropic')
  const [newBaseUrl, setNewBaseUrl] = useState('')
  const [suggesting, setSuggesting] = useState(false)

  async function suggestFromKeys() {
    setSuggesting(true)
    try {
      const res = await fetch(`/api/harnesses/${harnessId}/models/suggest`)
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to load suggestions')
        return
      }
      if (!data.suggested?.length) {
        toast.info('No API keys detected — add keys to .env first')
        return
      }
      const newEntries: FallbackProviderEntry[] = data.suggested.map((s: { provider: string; model: string; base_url?: string }) => ({
        provider: s.provider === 'ollama' ? 'ollama' : s.provider,
        model: s.model,
        ...(s.base_url ? { base_url: s.base_url } : {}),
      }))
      setCascade(newEntries)
      toast.success(`Suggested ${data.suggested.length} models from ${data.providers.length} provider${data.providers.length === 1 ? '' : 's'}`)
    } catch {
      toast.error('Failed to load suggestions')
    } finally {
      setSuggesting(false)
    }
  }

  // Sync when data loads
  useEffect(() => {
    const built = buildInitialCascade()
    if (built.length > 0 && cascade.length === 0) {
      setCascade(built)
    }
  }, [initialFallbackProviders, initialModels])

  const showBaseUrl = newProvider === 'ollama' || newProvider === 'custom'

  function addModel() {
    const m = newModel.trim()
    if (!m || !newProvider) return
    if (cascade.some((e) => e.model === m && e.provider === newProvider)) return
    const entry: FallbackProviderEntry = { provider: newProvider, model: m }
    if (showBaseUrl && newBaseUrl.trim()) {
      entry.base_url = newBaseUrl.trim()
    }
    setCascade([...cascade, entry])
    setNewModel('')
    setNewBaseUrl('')
  }

  function removeModel(index: number) {
    setCascade(cascade.filter((_, i) => i !== index))
  }

  function moveUp(index: number) {
    if (index === 0) return
    const next = [...cascade]
    ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
    setCascade(next)
  }

  function moveDown(index: number) {
    if (index >= cascade.length - 1) return
    const next = [...cascade]
    ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
    setCascade(next)
  }

  const isDirty = JSON.stringify(cascade) !== JSON.stringify(buildInitialCascade())

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Model Cascade</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={suggestFromKeys}
              disabled={suggesting}
              className="text-xs text-[var(--accent)] hover:underline disabled:opacity-50"
            >
              {suggesting ? 'Detecting...' : 'Suggest from connected keys'}
            </button>
            <span className="text-xs text-muted-foreground">Primary at top, fallbacks below</span>
          </div>
        </div>

        {cascade.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No models configured. Add one below.</p>
        ) : (
          <div className="space-y-1">
            {cascade.map((entry, i) => (
              <div
                key={`${entry.provider}-${entry.model}-${i}`}
                className={`flex items-center gap-2 p-2 rounded-md border ${i === 0 ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)]'}`}
              >
                <span className="text-xs text-muted-foreground w-5 text-center font-medium">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono truncate">{entry.model}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium uppercase tracking-wide shrink-0">
                      {entry.provider}
                    </span>
                  </div>
                  {entry.base_url && (
                    <p className="text-[11px] font-mono text-muted-foreground mt-0.5 truncate">
                      {entry.base_url}
                    </p>
                  )}
                </div>
                <div className="flex gap-0.5 shrink-0">
                  <button
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    className="text-xs px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveDown(i)}
                    disabled={i >= cascade.length - 1}
                    className="text-xs px-1.5 py-0.5 rounded hover:bg-muted disabled:opacity-30"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeModel(i)}
                    className="text-xs px-1.5 py-0.5 rounded hover:bg-[var(--danger)]/10 text-[var(--danger)]"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add model */}
        <div className="space-y-2">
          <div className="flex gap-2">
            <select
              value={newProvider}
              onChange={(e) => setNewProvider(e.target.value)}
              className="text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--bg)] w-36"
            >
              {MODEL_PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <input
              type="text"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !showBaseUrl && addModel()}
              placeholder="Model name (e.g. claude-sonnet-4-6)"
              className="flex-1 text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--bg)] font-mono"
            />
            <Button size="sm" variant="outline" onClick={addModel} disabled={!newModel.trim()}>
              Add
            </Button>
          </div>
          {showBaseUrl && (
            <input
              type="text"
              value={newBaseUrl}
              onChange={(e) => setNewBaseUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addModel()}
              placeholder="Base URL (e.g. http://host.docker.internal:11434/v1)"
              className="w-full text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--bg)] font-mono"
            />
          )}
        </div>

        {isDirty && (
          <Button size="sm" onClick={() => onSave(cascade)} disabled={saving}>
            {saving ? 'Saving...' : 'Save Cascade'}
          </Button>
        )}
      </div>
    </div>
  )
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function Row({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  )
}
