'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useApi } from '@/lib/hooks/use-api'
import { StatusDot } from '@/components/shared/status-dot'
import { TierBadge } from '@/components/shared/tier-badge'
import { CacheStatePill } from '@/components/shared/cache-state-pill'
import { Button } from '@/components/ui/button'
import { SplitButton } from '@/components/shared/split-button'
import { RiskBar } from '@/components/shared/risk-bar'
import { TierMix } from '@/components/shared/tier-mix'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Harness, Tool, Key, MemoryScope, Surface } from '@/lib/types'
import { SignalSetupDialog } from '@/components/surfaces/signal-setup-dialog'
import { TelegramSetupDialog } from '@/components/surfaces/telegram-setup-dialog'
import { MattermostSetupDialog } from '@/components/surfaces/mattermost-setup-dialog'
import { EditSurfaceDialog } from '@/components/surfaces/edit-surface-dialog'
import { SettingsTab } from '@/components/harness/settings-tab'
import { toast } from 'sonner'
import { MessageSquare, Globe, Bot, Hash, Pencil } from 'lucide-react'

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

export default function HarnessDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const { data: harness, loading, refetch } = useApi<Harness>(`/api/harnesses/${id}`)
  const { data: tools } = useApi<Tool[]>('/api/tools')
  const { data: keys } = useApi<Key[]>('/api/keys')
  const { data: memoryScopes } = useApi<MemoryScope[]>('/api/memory-scopes')
  const { data: surfaces, refetch: refetchSurfaces } = useApi<Surface[]>('/api/surfaces')
  const { data: modelConfig, refetch: refetchModels } = useApi<ModelConfig>(`/api/harnesses/${id}/models`)

  const [connectDialog, setConnectDialog] = useState<string | null>(null)
  const [editSurface, setEditSurface] = useState<Surface | null>(null)

  // Model edit state
  const [modelProvider, setModelProvider] = useState('')
  const [modelName, setModelName] = useState('')
  const [modelSaving, setModelSaving] = useState(false)

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
  const harnessKeys = keys?.filter((k) => k.assignedTo.includes(harness.id)) ?? []
  const harnessMemory = memoryScopes?.filter((m) => m.members.includes(harness.id)) ?? []
  const connectedSurfaces = surfaces?.filter((s) => s.harnessIds.includes(harness.id)) ?? []
  const otherSurfaces = surfaces?.filter((s) => !s.harnessIds.includes(harness.id)) ?? []

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <StatusDot status={harness.status} />
          <div>
            <h2 className="text-2xl font-semibold">{harness.name}</h2>
            <div className="flex items-center gap-2 mt-1">
              <TierBadge tier={harness.tier} />
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
          <TabsTrigger value="models">Models</TabsTrigger>
          <TabsTrigger value="tools">Tools ({harnessTools.length})</TabsTrigger>
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
              <Row label="Invocations" value={harness.invocations} />
              <Row label="Cost today" value={`$${harness.costToday.toFixed(2)}`} />
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

        <TabsContent value="models" className="mt-4">
          <ModelCascadeEditor
            models={modelConfig?.models ?? harness.models ?? []}
            provider={modelConfig?.provider ?? ''}
            onSave={async (models) => {
              setModelSaving(true)
              try {
                const res = await fetch(`/api/harnesses/${id}/models`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ provider: models.length > 0 ? (modelConfig?.provider || 'anthropic') : '', model: models[0] || '', cascade: models }),
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
            {/* Connected surfaces */}
            {connectedSurfaces.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Connected</h3>
                {connectedSurfaces.map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {PLATFORM_ICONS[s.platform.toLowerCase()] ?? <Globe className="h-4 w-4" />}
                      </span>
                      <div>
                        <p className="font-medium text-sm">{s.name}</p>
                        <p className="text-xs text-muted-foreground capitalize">{s.platform}</p>
                        {s.config.url && (
                          <p className="text-xs font-mono text-muted-foreground">{s.config.url}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SURFACE_STATUS_STYLES[s.status]}`}>
                        {s.status}
                      </span>
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
                              body: JSON.stringify({ platform: s.platform.toLowerCase() }),
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
                ))}
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
          </div>
        </TabsContent>

        <TabsContent value="tools" className="mt-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="text-left px-4 py-3">Tool</th>
                  <th className="text-left px-4 py-3">Source</th>
                  <th className="text-left px-4 py-3">Risk</th>
                  <th className="text-left px-4 py-3">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {harnessTools.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">{t.description}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{t.source}</td>
                    <td className="px-4 py-3"><RiskBar level={t.risk} /></td>
                    <td className="px-4 py-3">
                      <span className={t.reviewed ? 'text-[var(--success)]' : 'text-muted-foreground'}>
                        {t.reviewed ? 'Yes' : 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
                {harnessTools.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground text-sm">No tools assigned.</td></tr>
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
          <SettingsTab
            harnessId={harness.id}
            connectedSurfaces={connectedSurfaces}
          />
        </TabsContent>
      </Tabs>

      <SignalSetupDialog
        open={connectDialog === 'signal'}
        onClose={() => setConnectDialog(null)}
        harnessId={harness.id}
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
  provider,
  onSave,
  saving,
}: {
  models: string[]
  provider: string
  onSave: (models: string[]) => void
  saving: boolean
}) {
  const [cascade, setCascade] = useState<string[]>(initialModels.length > 0 ? initialModels : [])
  const [newModel, setNewModel] = useState('')

  // Sync when data loads
  useEffect(() => {
    if (initialModels.length > 0 && cascade.length === 0) {
      setCascade(initialModels)
    }
  }, [initialModels])

  function addModel() {
    const m = newModel.trim()
    if (!m || cascade.includes(m)) return
    setCascade([...cascade, m])
    setNewModel('')
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

  const isDirty = JSON.stringify(cascade) !== JSON.stringify(initialModels)

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">Model Cascade</h3>
          <span className="text-xs text-muted-foreground">Primary at top, fallbacks below</span>
        </div>

        {cascade.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No models configured. Add one below.</p>
        ) : (
          <div className="space-y-1">
            {cascade.map((model, i) => (
              <div
                key={`${model}-${i}`}
                className={`flex items-center gap-2 p-2 rounded-md border ${i === 0 ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-[var(--border)]'}`}
              >
                <span className="text-xs text-muted-foreground w-5 text-center font-medium">
                  {i === 0 ? '1' : i + 1}
                </span>
                <span className="flex-1 text-sm font-mono">{model}</span>
                <div className="flex gap-0.5">
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
        <div className="flex gap-2">
          <input
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addModel()}
            placeholder="Model name (e.g. claude-sonnet-4-6)"
            className="flex-1 text-sm border border-[var(--border)] rounded-md px-2 py-1.5 bg-[var(--bg)] font-mono"
          />
          <Button size="sm" variant="outline" onClick={addModel} disabled={!newModel.trim()}>
            Add
          </Button>
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

function Row({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  )
}
