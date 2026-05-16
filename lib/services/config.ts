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

    // Collect env data per harness
    type SurfaceAccumulator = {
      surface: Omit<Surface, 'harnessIds'>
      harnessIds: string[]
    }

    const mattermostAcc: SurfaceAccumulator = {
      surface: {
        id: 'int_mm',
        platform: 'mattermost',
        name: 'Mattermost',
        status: 'planned',
        config: {},
      },
      harnessIds: [],
    }

    const telegramAcc: SurfaceAccumulator = {
      surface: {
        id: 'int_tg',
        platform: 'telegram',
        name: 'Telegram',
        status: 'planned',
        config: {},
      },
      harnessIds: [],
    }

    for (const name of names) {
      const dataDir = agentDataDir(name)
      const envPath = path.join(dataDir, '.env')
      const env = parseEnvFile(envPath)
      const harnessId = `h_${name.replace(/-/g, '_')}`

      if (env['MATTERMOST_TOKEN'] || env['MATTERMOST_URL']) {
        mattermostAcc.surface.status = 'connected'
        if (env['MATTERMOST_URL'] && !mattermostAcc.surface.config['url']) {
          mattermostAcc.surface.config = { url: env['MATTERMOST_URL'] }
        }
        if (!mattermostAcc.harnessIds.includes(harnessId)) {
          mattermostAcc.harnessIds.push(harnessId)
        }
      }

      if (env['TELEGRAM_BOT_TOKEN']) {
        telegramAcc.surface.status = 'connected'
        if (!telegramAcc.harnessIds.includes(harnessId)) {
          telegramAcc.harnessIds.push(harnessId)
        }
      }
    }

    const surfaces: Surface[] = [
      { ...mattermostAcc.surface, harnessIds: mattermostAcc.harnessIds },
      { ...telegramAcc.surface, harnessIds: telegramAcc.harnessIds },
      // Stub surfaces — not yet connected
      { id: 'int_dc', platform: 'discord', name: 'Discord', status: 'planned', config: {}, harnessIds: [] },
      { id: 'int_sg', platform: 'signal', name: 'Signal', status: 'planned', config: {}, harnessIds: [] },
    ]

    return surfaces
  }
}
