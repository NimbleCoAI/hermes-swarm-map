export type HabitatTier = 'individual' | 'team' | 'org' | 'orgpublic' | 'public'

export type HarnessStatus = 'running' | 'idle' | 'stopped' | 'error' | 'restarting'

export type CacheState = 'warm' | 'cold' | 'stale'

// quick:    docker compose restart — restarts the process, does NOT reload env_file
// recreate: up -d --force-recreate — recreates the container, reloads env_file (no image build)
// rebuild:  up -d --build --force-recreate — rebuilds image + recreates
// purge:    build --no-cache + up -d --force-recreate — full from-scratch rebuild
export type RestartMode = 'quick' | 'recreate' | 'rebuild' | 'purge'

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
  // The host port this agent's compose publishes (API_SERVER_PORT). Persisted so
  // port allocation has an authoritative source — `channel` is only a display
  // string (":8642") and live Docker state is absent for not-yet-started agents.
  apiPort?: number
  cacheState?: CacheState
  cacheAge?: number
  composeFile?: string
  serviceName?: string
  // CD: the image ref this agent is intentionally pinned to (digest or tag), and
  // the digest it last resolved to — for "update available" surfacing + rollback.
  pinnedImageRef?: string
  lastKnownDigest?: string
  // Per-harness compose resource limits (deploy.resources.limits). Persisted on
  // the overlay and re-rendered into the compose on change. Memory-heavy
  // harnesses OOM-kill under the hardcoded 2G default; raise these to fit the job.
  resources?: { memory?: string; cpus?: string }
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
  name?: string
  maskedValue: string
  assignedTo: string[]
  budgetUsd?: number
  health: 'good' | 'warning' | 'expired'
}

export type KeyInput = {
  provider: string
  value: string
  name?: string
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
  defaultImage?: string  // Default Docker image for new agents (default: nousresearch/hermes-agent:latest)
  useLocalBuild?: boolean  // Build from hermesDir instead of pulling upstream image
  localApiEnabled?: boolean  // Expose harnesses at a local API endpoint
  localApiPort?: number  // Port for the local API (default 8600)
  vncBindHost?: string  // Host interface for the VPN-mode VNC port (default '127.0.0.1'); set to a Tailscale address for remote human CAPTCHA escalation
}
