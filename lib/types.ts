export type HabitatTier = 'individual' | 'team' | 'org' | 'orgpublic' | 'public'

export type HarnessStatus = 'running' | 'idle' | 'stopped' | 'error'

export type CacheState = 'warm' | 'cold' | 'stale'

export type RestartMode = 'quick' | 'rebuild' | 'purge'

export type Harness = {
  id: string
  name: string
  runtime: 'hermes' | 'claude-code-proxy' | 'custom'
  parentId?: string
  status: HarnessStatus
  health: { errors: number; errorMsg?: string }
  persona: string
  tier: HabitatTier
  platform: string
  channel: string
  lastSeen: number
  models: string[]
  costToday: number
  invocations: number
  cpu: number
  mem: number
  tools: string[]
  cacheState?: CacheState
  cacheAge?: number
  composeFile?: string
  serviceName?: string
}

export type Surface = {
  id: string
  platform: string
  name: string
  status: 'connected' | 'available' | 'planned'
  config: Record<string, string>
  harnessIds: string[]
}

export type Key = {
  id: string
  provider: string
  maskedValue: string
  assignedTo: string[]
  budgetUsd?: number
  health: 'good' | 'warning' | 'expired'
}

export type KeyInput = {
  provider: string
  value: string
  budgetUsd?: number
}

export type Tool = {
  id: string
  name: string
  source: 'builtin' | 'mcp' | 'custom'
  risk: 1 | 2 | 3 | 4 | 5
  allowedTiers: HabitatTier[]
  reviewed: boolean
  description: string
}

export type MemoryScope = {
  id: string
  name: string
  strategy: 'siloed-runtime' | 'tag-gated'
  members: string[]
  sizeMb: number
  tier: HabitatTier
}

export type Model = {
  id: string
  name: string
  vendor: string
  costClass: 'free' | 'low' | 'medium' | 'high' | 'local'
  accessTier: 'open' | 'admin'
  notes?: string
}

export type Person = {
  id: string
  handle: string
  role: 'admin' | 'community'
  surfaces: string[]
}

export type AuditEntry = {
  ts: number
  who: string
  what: string
  target: string
  meta?: Record<string, unknown>
}

export type Settings = {
  hermesDir: string  // directory to scan for docker-compose*.yml files
  dataDir: string
  theme: 'light' | 'dark'
  composeFiles: string[]  // explicit list of compose files; empty = auto-scan hermesDir
  onboarded?: boolean
  useLocalBuild?: boolean  // Build from hermesDir instead of pulling upstream image
}
