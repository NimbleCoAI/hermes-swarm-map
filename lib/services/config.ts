import type { Settings, Model, Person, Surface } from '@/lib/types'
import type { Storage } from './storage'

const SETTINGS_FILE = 'settings.json'
const MODELS_FILE = 'models.json'
const PEOPLE_FILE = 'people.json'
const SURFACES_FILE = 'surfaces.json'

const DEFAULT_SETTINGS: Settings = {
  hermesDir: '~/hermes-agent',
  dataDir: '~/.hermes-swarm-map',
  theme: 'light',
}

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

  listSurfaces(): Surface[] {
    return this.storage.read<Surface[]>(SURFACES_FILE, [])
  }
}
