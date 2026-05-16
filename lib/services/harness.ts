import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'
import type { Harness, HarnessStatus, HabitatTier, RestartMode } from '@/lib/types'
import type { Storage } from './storage'
import type { DockerService } from './docker'
import type { AuditService } from './audit'
import type { ConfigService } from './config'

const HARNESSES_FILE = 'harnesses.json'

// Services that are infrastructure, not Hermes agents — skip during discovery
const EXCLUDED_SERVICES = new Set(['litellm', 'vertex-proxy'])

function expandPath(p: string): string {
  return p.replace(/^~/, os.homedir())
}

function containerNameToHarnessName(containerName: string): string {
  // hermes-personal → personal, seraph-thinker → seraph-thinker
  return containerName.replace(/^hermes-/, '')
}

function stateToStatus(state: string): HarnessStatus {
  switch (state) {
    case 'running': return 'running'
    case 'exited': return 'stopped'
    case 'restarting': return 'error'
    case 'created': return 'idle'
    default: return 'stopped'
  }
}

function readSoul(dataDir: string, maxChars = 200): string {
  try {
    const soulPath = path.join(dataDir, 'SOUL.md')
    const content = fs.readFileSync(soulPath, 'utf-8')
    // Strip markdown headers/lines, grab first meaningful text
    const lines = content
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('*') && !l.startsWith('---'))
    const text = lines.join(' ').slice(0, maxChars)
    return text || ''
  } catch {
    return ''
  }
}

function getComposeFilesForDir(hermesDir: string): string[] {
  const expanded = expandPath(hermesDir)
  try {
    const entries = fs.readdirSync(expanded)
    return entries
      .filter((f) => f.startsWith('docker-compose') && f.endsWith('.yml'))
      .map((f) => path.join(expanded, f))
  } catch {
    return []
  }
}

function getServicesFromComposeFile(composeFile: string): string[] {
  try {
    const output = execSync(
      `docker compose -f ${composeFile} config --services`,
      { stdio: 'pipe', timeout: 10000 }
    ).toString()
    return output.trim().split('\n').filter((s) => s.trim())
  } catch {
    return []
  }
}

// Map service name to the data directory where its SOUL.md lives
function guessDataDir(serviceName: string, containerName: string): string {
  // hermes-personal → ~/.hermes (the default/personal instance)
  // hermes-osint → ~/.hermes-osint
  // seraph-thinker → ~/.hermes-seraph-thinker
  const home = os.homedir()
  if (containerName === 'hermes-personal' || serviceName === 'hermes-personal') {
    return path.join(home, '.hermes')
  }
  if (serviceName.startsWith('hermes-')) {
    return path.join(home, '.' + serviceName)
  }
  // seraph-* agents
  if (serviceName.startsWith('seraph-')) {
    return path.join(home, '.hermes-' + serviceName)
  }
  return path.join(home, '.hermes-' + serviceName)
}

export class HarnessService {
  constructor(
    private storage: Storage,
    private docker: DockerService,
    private audit: AuditService,
    private config?: ConfigService,
  ) {}

  // Load stored overlays — tier, tools, keys, and other user-configured fields
  private loadOverlays(): Record<string, Partial<Harness>> {
    const stored = this.storage.read<Harness[]>(HARNESSES_FILE, [])
    const overlays: Record<string, Partial<Harness>> = {}
    for (const h of stored) {
      overlays[h.id] = h
    }
    return overlays
  }

  // Write overlays back — only persists user-configured fields, not live Docker state
  private saveOverlays(harnesses: Harness[]): void {
    this.storage.write(HARNESSES_FILE, harnesses)
  }

  discover(): { harnesses: Harness[]; error?: string } {
    if (!this.docker.isAvailable()) {
      return { harnesses: [], error: 'Docker is not available' }
    }

    const settings = this.config?.getSettings()
    const hermesDir = settings?.hermesDir ?? '~/Documents/GitHub/hermes-swarm'
    const configuredFiles = settings?.composeFiles ?? []

    // Determine which compose files to scan
    const composeFiles =
      configuredFiles.length > 0
        ? configuredFiles.map(expandPath)
        : getComposeFilesForDir(hermesDir)

    if (composeFiles.length === 0) {
      return { harnesses: [], error: `No docker-compose*.yml files found in ${hermesDir}` }
    }

    const overlays = this.loadOverlays()

    // Build a map of container name → live state via `docker compose ls` + per-project inspect
    // Use the project name "hermes-swarm" since that's how both files are deployed
    const liveContainers: Record<string, {
      state: string
      ports: Array<{ published: number; target: number }>
      composeFile: string
      serviceName: string
    }> = {}

    // Find the project names for our compose files via `docker compose ls`
    const projects = this.docker.listComposeProjects()
    // Build a set of absolute config file paths we care about
    const wantedFiles = new Set(composeFiles.map((f) => expandPath(f)))

    for (const project of projects) {
      const matchingFiles = project.configFiles.filter((f) => wantedFiles.has(f))
      if (matchingFiles.length === 0) continue

      const containers = this.docker.inspectContainers(project.name)
      for (const c of containers) {
        if (EXCLUDED_SERVICES.has(c.service)) continue
        // Prefer the config file that was in our wanted set
        const composeFile = c.composeFile ?? matchingFiles[0]
        liveContainers[c.name] = {
          state: c.state,
          ports: c.ports,
          composeFile,
          serviceName: c.service,
        }
      }
    }

    // If project-based lookup gave nothing, fall back to per-file inspection
    if (Object.keys(liveContainers).length === 0) {
      for (const composeFile of composeFiles) {
        const containers = this.docker.inspectContainers(
          path.basename(path.dirname(composeFile))
        )
        // Also try direct file-based approach
        const raw = this.docker.listContainers(composeFile)
        for (const c of raw) {
          if (EXCLUDED_SERVICES.has(c.service)) continue
          liveContainers[c.name] = {
            state: c.state,
            ports: [],
            composeFile,
            serviceName: c.service,
          }
        }
        void containers // suppress unused warning
      }
    }

    // Batch stats for ALL containers in one Docker call (~2s total, not 10s per container)
    const allStats = this.docker.getAllContainerStats()

    const harnesses: Harness[] = []

    for (const [containerName, live] of Object.entries(liveContainers)) {
      const name = containerNameToHarnessName(containerName)
      const id = 'h_' + name.replace(/-/g, '_')
      const dataDir = guessDataDir(live.serviceName, containerName)
      const persona = readSoul(dataDir)

      const stats = allStats[containerName] ?? { cpu: 0, memMiB: 0 }

      // Port: first published port
      const port = live.ports[0]?.published

      const overlay = overlays[id] ?? {}

      const harness: Harness = {
        // Discoverable fields
        id,
        name,
        runtime: 'hermes',
        status: stateToStatus(live.state),
        health: { errors: 0 },
        persona: persona || overlay.persona || `Hermes agent: ${name}`,
        lastSeen: Date.now(),
        cpu: stats.cpu,
        mem: stats.memMiB,
        composeFile: live.composeFile,
        serviceName: live.serviceName,
        // Overlay fields (user-configured) — fall back to sensible defaults
        tier: overlay.tier ?? 'individual',
        platform: overlay.platform ?? 'hermes',
        channel: overlay.channel ?? (port ? `:${port}` : ''),
        models: overlay.models ?? [],
        costToday: overlay.costToday ?? 0,
        invocations: overlay.invocations ?? 0,
        tools: overlay.tools ?? [],
        ...(overlay.health ? { health: overlay.health } : {}),
        ...(overlay.cacheState ? { cacheState: overlay.cacheState } : {}),
        ...(overlay.cacheAge !== undefined ? { cacheAge: overlay.cacheAge } : {}),
        ...(overlay.parentId ? { parentId: overlay.parentId } : {}),
      }

      harnesses.push(harness)
    }

    // Sort: hermes-* first, then seraph-*
    harnesses.sort((a, b) => {
      const aIsSeraph = a.name.startsWith('seraph-') ? 1 : 0
      const bIsSeraph = b.name.startsWith('seraph-') ? 1 : 0
      if (aIsSeraph !== bIsSeraph) return aIsSeraph - bIsSeraph
      return a.name.localeCompare(b.name)
    })

    return { harnesses }
  }

  list(): Harness[] {
    const { harnesses } = this.discover()
    // Fall back to stored overlays if Docker discovery returned nothing
    if (harnesses.length === 0) {
      return this.storage.read<Harness[]>(HARNESSES_FILE, [])
    }
    return harnesses
  }

  get(id: string): Harness | undefined {
    return this.list().find((h) => h.id === id)
  }

  updateConfig(id: string, partial: Partial<Harness>): Harness | undefined {
    // Load existing overlays, merge, persist
    const overlays = this.storage.read<Harness[]>(HARNESSES_FILE, [])
    const index = overlays.findIndex((h) => h.id === id)
    if (index !== -1) {
      overlays[index] = { ...overlays[index], ...partial }
    } else {
      // New overlay entry — we need at least a skeleton
      const current = this.get(id)
      if (!current) return undefined
      overlays.push({ ...current, ...partial })
    }
    this.saveOverlays(overlays)
    return this.get(id)
  }

  restart(id: string, mode: RestartMode): void {
    const harness = this.get(id)
    if (!harness?.composeFile || !harness.serviceName) {
      throw new Error(`Harness ${id} has no compose file configured`)
    }
    this.docker.restart(harness.composeFile, harness.serviceName, mode)
    this.audit.append({ who: 'admin', what: `restart:${mode}`, target: harness.name })
  }

  start(id: string): void {
    const harness = this.get(id)
    if (!harness?.composeFile || !harness.serviceName) {
      throw new Error(`Harness ${id} has no compose file configured`)
    }
    this.docker.start(harness.composeFile, harness.serviceName)
    this.audit.append({ who: 'admin', what: 'start', target: harness.name })
  }

  stop(id: string): void {
    const harness = this.get(id)
    if (!harness?.composeFile || !harness.serviceName) {
      throw new Error(`Harness ${id} has no compose file configured`)
    }
    this.docker.stop(harness.composeFile, harness.serviceName)
    this.audit.append({ who: 'admin', what: 'stop', target: harness.name })
  }

  duplicateOverlay(sourceId: string, newName: string): Partial<Harness> | undefined {
    const overlays = this.storage.read<Partial<Harness>[]>('harnesses.json', [])
    const source = overlays.find((h) => h.id === sourceId)
    if (!source) return undefined

    const newId = 'h_' + newName.replace(/-/g, '_').replace(/\s+/g, '_')
    const duplicate: Partial<Harness> = {
      ...source,
      id: newId,
      name: newName,
    }

    overlays.push(duplicate)
    this.storage.write('harnesses.json', overlays)

    this.audit.append({
      who: 'admin',
      what: 'duplicate',
      target: `${source.name ?? sourceId} → ${newName}`,
    })

    return duplicate
  }

  createOverlay(input: { name: string; tier?: HabitatTier; platform?: string; channel?: string; models?: string[] }): Partial<Harness> {
    const overlays = this.storage.read<Partial<Harness>[]>('harnesses.json', [])

    // Check for duplicate name
    const id = 'h_' + input.name.replace(/-/g, '_').replace(/\s+/g, '_')
    if (overlays.some((h) => h.id === id || h.name === input.name)) {
      throw new Error(`Harness "${input.name}" already exists`)
    }

    const overlay: Partial<Harness> = {
      id,
      name: input.name,
      tier: input.tier ?? 'individual',
      platform: input.platform ?? 'hermes',
      channel: input.channel ?? '',
      models: input.models ?? [],
      tools: [],
    }

    overlays.push(overlay)
    this.storage.write('harnesses.json', overlays)
    this.audit.append({ who: 'admin', what: 'create', target: input.name })
    return overlay
  }

  importFromDir(dataDir: string, name: string): Partial<Harness> {
    // Read SOUL.md for persona
    let persona = ''
    try {
      const soulPath = path.join(dataDir, 'SOUL.md')
      const content = fs.readFileSync(soulPath, 'utf-8')
      const lines = content
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && !l.startsWith('---'))
      persona = lines.join(' ').slice(0, 200)
    } catch {}

    // Detect platform from .env
    let platform = 'hermes'
    try {
      const envContent = fs.readFileSync(path.join(dataDir, '.env'), 'utf-8')
      if (envContent.includes('MATTERMOST_TOKEN') || envContent.includes('MATTERMOST_URL')) {
        platform = 'mattermost'
      } else if (envContent.includes('TELEGRAM_BOT_TOKEN')) {
        platform = 'telegram'
      }
    } catch {}

    const overlay = this.createOverlay({ name, platform })
    if (persona) {
      overlay.persona = persona
      // Update the stored overlay
      const overlays = this.storage.read<Partial<Harness>[]>('harnesses.json', [])
      const idx = overlays.findIndex((h) => h.id === overlay.id)
      if (idx !== -1) {
        overlays[idx].persona = persona
        this.storage.write('harnesses.json', overlays)
      }
    }

    return overlay
  }

  restartRunning(): { restarted: string[]; errors: Record<string, string> } {
    const running = this.list().filter((h) => h.status === 'running')
    const restarted: string[] = []
    const errors: Record<string, string> = {}
    for (const harness of running) {
      try {
        if (harness.composeFile && harness.serviceName) {
          this.docker.restart(harness.composeFile, harness.serviceName, 'quick')
          restarted.push(harness.id)
          this.audit.append({ who: 'admin', what: 'restart:quick', target: harness.name })
        }
      } catch (err) {
        errors[harness.id] = err instanceof Error ? err.message : String(err)
      }
    }
    return { restarted, errors }
  }
}
