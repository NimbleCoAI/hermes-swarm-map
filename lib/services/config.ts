import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Settings, Model, Person, Surface } from '@/lib/types'
import type { Storage } from './storage'

const SETTINGS_FILE = 'settings.json'
const MODELS_FILE = 'models.json'
const PEOPLE_FILE = 'people.json'

const DEFAULT_SETTINGS: Settings = {
  hermesDir: '~/Documents/GitHub/hermes-swarm',
  dataDir: '~/.hermes-swarm-map',
  theme: 'light',
  composeFiles: [],
}

// Agent data directory mapping
function agentDataDir(harnessName: string): string {
  if (harnessName === 'personal') {
    return path.join(os.homedir(), '.hermes')
  }
  return path.join(os.homedir(), `.hermes-${harnessName}`)
}

// Parse a .env file, return key→value map (raw, unmasked — for internal use only)
function parseEnvFile(envPath: string): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const varName = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (varName && value && !value.startsWith('${')) {
        result[varName] = value
      }
    }
  } catch {
    // no .env or can't read
  }
  return result
}

const DEFAULT_HARNESS_NAMES = [
  'personal',
  'cryptids',
  'cyborg',
  'egregore',
  'osint',
  'seraph-doer',
  'seraph-generalist',
  'seraph-thinker',
]

export class ConfigService {
  constructor(private storage: Storage) {}

  getSettings(): Settings {
    return this.storage.read<Settings>(SETTINGS_FILE, DEFAULT_SETTINGS)
  }

  updateSettings(partial: Partial<Settings>): Settings {
    const current = this.getSettings()
    const updated = { ...current, ...partial }
    this.storage.write(SETTINGS_FILE, updated)
    return updated
  }

  listModels(): Model[] {
    return this.storage.read<Model[]>(MODELS_FILE, [])
  }

  updateModel(id: string, partial: Partial<Model>): Model | undefined {
    const models = this.listModels()
    const index = models.findIndex((m) => m.id === id)
    if (index === -1) return undefined
    models[index] = { ...models[index], ...partial }
    this.storage.write(MODELS_FILE, models)
    return models[index]
  }

  listPeople(): Person[] {
    return this.storage.read<Person[]>(PEOPLE_FILE, [])
  }

  listSurfaces(harnessNames?: string[]): Surface[] {
    const names = harnessNames ?? DEFAULT_HARNESS_NAMES

    // Per-harness surfaces — each harness owns its own surface instances.
    // No cross-harness leaking of phone numbers, tokens, or URLs.
    const surfaces: Surface[] = []
    const seenPlatforms = new Set<string>()

    for (const name of names) {
      const dataDir = agentDataDir(name)
      const envPath = path.join(dataDir, '.env')
      const env = parseEnvFile(envPath)
      const harnessId = `h_${name.replace(/-/g, '_')}`

      if (env['MATTERMOST_TOKEN'] || env['MATTERMOST_URL']) {
        seenPlatforms.add('mattermost')
        surfaces.push({
          id: `int_mm_${name}`,
          platform: 'mattermost',
          name: 'Mattermost',
          status: 'connected',
          config: { url: env['MATTERMOST_URL'] || '' },
          harnessIds: [harnessId],
        })
      }

      if (env['TELEGRAM_BOT_TOKEN']) {
        seenPlatforms.add('telegram')
        surfaces.push({
          id: `int_tg_${name}`,
          platform: 'telegram',
          name: 'Telegram',
          status: 'connected',
          config: {},
          harnessIds: [harnessId],
        })
      }

      if (env['SIGNAL_ACCOUNT'] && env['SIGNAL_HTTP_URL']) {
        seenPlatforms.add('signal')
        surfaces.push({
          id: `int_sg_${name}`,
          platform: 'signal',
          name: 'Signal',
          status: 'connected',
          config: { phone: env['SIGNAL_ACCOUNT'], url: env['SIGNAL_HTTP_URL'] },
          harnessIds: [harnessId],
        })
      }
    }

    // Add available (not yet connected) platform stubs for platforms
    // that at least one harness uses, so the "Available" section shows them
    // for harnesses that haven't connected yet.
    if (seenPlatforms.has('mattermost')) {
      surfaces.push({ id: 'int_mm_available', platform: 'mattermost', name: 'Mattermost', status: 'available', config: {}, harnessIds: [] })
    } else {
      surfaces.push({ id: 'int_mm', platform: 'mattermost', name: 'Mattermost', status: 'planned', config: {}, harnessIds: [] })
    }

    if (seenPlatforms.has('telegram')) {
      surfaces.push({ id: 'int_tg_available', platform: 'telegram', name: 'Telegram', status: 'available', config: {}, harnessIds: [] })
    } else {
      surfaces.push({ id: 'int_tg', platform: 'telegram', name: 'Telegram', status: 'planned', config: {}, harnessIds: [] })
    }

    if (seenPlatforms.has('signal')) {
      surfaces.push({ id: 'int_sg_available', platform: 'signal', name: 'Signal', status: 'available', config: {}, harnessIds: [] })
    } else {
      surfaces.push({ id: 'int_sg', platform: 'signal', name: 'Signal', status: 'planned', config: {}, harnessIds: [] })
    }

    // Discord stub — not yet implemented
    surfaces.push({ id: 'int_dc', platform: 'discord', name: 'Discord', status: 'planned', config: {}, harnessIds: [] })

    return surfaces
  }
}
