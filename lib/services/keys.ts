import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import type { Key, KeyInput } from '@/lib/types'
import type { Storage } from './storage'
import type { AuditService } from './audit'

const KEYS_FILE = 'keys.json'

type StoredKey = Key & { encryptedValue: string; manuallyAdded?: boolean }

// Overlay for user-configured fields (budget, health, assignedTo overrides)
type KeyOverride = Partial<Key> & { id: string }

function maskValue(value: string): string {
  if (value.length <= 8) return '••••'
  const prefix = value.slice(0, 4)
  const suffix = value.slice(-4)
  return `${prefix}…${suffix}`
}

function generateId(): string {
  return `k_${crypto.randomBytes(6).toString('hex')}`
}

// Derive a stable ID from the masked key fingerprint (first 8 + last 8 chars of value)
function fingerprintId(value: string): string {
  const fp = value.slice(0, 8) + value.slice(-8)
  return 'k_' + crypto.createHash('sha1').update(fp).digest('hex').slice(0, 8)
}

type ProviderPattern = {
  varPattern: RegExp
  provider: string
  valuePattern?: RegExp
}

const PROVIDER_PATTERNS: ProviderPattern[] = [
  { varPattern: /^ANTHROPIC_API_KEY$/i, provider: 'anthropic', valuePattern: /^sk-ant-/ },
  { varPattern: /^OPENAI_API_KEY$/i, provider: 'openai', valuePattern: /^sk-/ },
  { varPattern: /^GITHUB_TOKEN$|^GITHUB_PAT$/i, provider: 'github', valuePattern: /^gh[pso]_/ },
  { varPattern: /^MATTERMOST_TOKEN$/i, provider: 'mattermost' },
  { varPattern: /^TELEGRAM_BOT_TOKEN$/i, provider: 'telegram' },
  { varPattern: /^NOTION_API_KEY$|^NOTION_TOKEN$/i, provider: 'notion', valuePattern: /^secret_/ },
  { varPattern: /^AWS_ACCESS_KEY_ID$/i, provider: 'aws', valuePattern: /^AKIA/ },
  { varPattern: /^AWS_BEARER_TOKEN_BEDROCK$/i, provider: 'aws-bedrock' },
  { varPattern: /^GOOGLE_CLOUD_API_KEY$/i, provider: 'google-cloud' },
  { varPattern: /^BRAVE_SEARCH_API_KEY$/i, provider: 'brave' },
  { varPattern: /^HELIUS_API_KEY$/i, provider: 'helius' },
  { varPattern: /^COINGECKO_API_KEY$/i, provider: 'coingecko' },
  { varPattern: /^DEHASHED_API_KEY$/i, provider: 'dehashed' },
  { varPattern: /^OPENCORPORATES_API_KEY$/i, provider: 'opencorporates' },
  { varPattern: /^CAPSOLVER_API_KEY$/i, provider: 'capsolver' },
  { varPattern: /^OPEN_MEASURES_API_KEY$/i, provider: 'open-measures' },
  { varPattern: /^PEXELS_API_KEY$/i, provider: 'pexels' },
]

function detectProvider(varName: string, value: string): string | null {
  for (const { varPattern, provider, valuePattern } of PROVIDER_PATTERNS) {
    if (varPattern.test(varName)) {
      if (!valuePattern || valuePattern.test(value)) {
        return provider
      }
      return provider // still match by var name even if value doesn't match pattern
    }
  }
  // Fallback: any var with KEY/TOKEN/SECRET/PASSWORD
  if (/KEY|TOKEN|SECRET|PASSWORD/i.test(varName)) {
    // Derive a provider name from the var name
    const name = varName
      .replace(/_?(API_KEY|API_TOKEN|TOKEN|SECRET|KEY|PASSWORD)_?/gi, '')
      .replace(/_+/g, '-')
      .toLowerCase()
      .replace(/^-+|-+$/g, '')
    return name || 'unknown'
  }
  return null
}

// Agent data directory mapping
function agentDataDir(harnessName: string): string {
  if (harnessName === 'personal') {
    return path.join(os.homedir(), '.hermes')
  }
  return path.join(os.homedir(), `.hermes-${harnessName}`)
}

// Parse a .env file into key=value pairs (skip comments and empty lines)
function parseEnvFile(envPath: string): Array<{ varName: string; value: string }> {
  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    const pairs: Array<{ varName: string; value: string }> = []
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const varName = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (varName && value && !value.startsWith('${')) {
        pairs.push({ varName, value })
      }
    }
    return pairs
  } catch {
    return []
  }
}

// Discover all keys from agent env files
function discoverKeys(harnessNames: string[]): Map<string, { key: StoredKey; harnesses: string[] }> {
  // Deduplicate by fingerprint: same key value = same key
  const registry = new Map<string, { key: StoredKey; harnesses: string[] }>()

  for (const harnessName of harnessNames) {
    const dataDir = agentDataDir(harnessName)
    const envPath = path.join(dataDir, '.env')
    const pairs = parseEnvFile(envPath)

    for (const { varName, value } of pairs) {
      const provider = detectProvider(varName, value)
      if (!provider) continue

      const fpId = fingerprintId(value)
      const existing = registry.get(fpId)
      if (existing) {
        if (!existing.harnesses.includes(harnessName)) {
          existing.harnesses.push(harnessName)
        }
      } else {
        const storedKey: StoredKey = {
          id: fpId,
          provider,
          maskedValue: maskValue(value),
          encryptedValue: value, // only stored server-side, never exposed in API
          assignedTo: [],
          health: 'good',
        }
        registry.set(fpId, { key: storedKey, harnesses: [harnessName] })
      }
    }
  }

  return registry
}

export class KeysService {
  constructor(
    private storage: Storage,
    private audit: AuditService,
  ) {}

  private defaultHarnessNames(): string[] {
    return [
      'personal',
      'cryptids',
      'cyborg',
      'egregore',
      'osint',
      'seraph-doer',
      'seraph-generalist',
      'seraph-thinker',
    ]
  }

  // Load user overrides (budget, health, assignedTo overrides)
  private loadOverrides(): Map<string, KeyOverride> {
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const map = new Map<string, KeyOverride>()
    for (const s of stored) {
      const { encryptedValue: _, ...k } = s
      map.set(k.id, k)
    }
    return map
  }

  list(harnessNames?: string[]): Key[] {
    const names = harnessNames ?? this.defaultHarnessNames()
    const registry = discoverKeys(names)
    const storedAll = this.storage.read<StoredKey[]>(KEYS_FILE, [])

    // Build override map for discovered keys
    const overrides = new Map<string, KeyOverride>()
    for (const s of storedAll) {
      if (!s.manuallyAdded) {
        const { encryptedValue: _, manuallyAdded: __, ...k } = s
        overrides.set(k.id, k)
      }
    }

    // Collect manually-added keys
    const manualKeys: Key[] = storedAll
      .filter((s) => s.manuallyAdded)
      .map((s) => {
        const { encryptedValue: _, manuallyAdded: __, ...k } = s
        return k
      })

    // Build discovered key list
    const discoveredKeys: Key[] = []
    for (const [id, { key, harnesses }] of registry) {
      const override = overrides.get(id)
      const { encryptedValue: _, ...baseKey } = key
      const merged: Key = {
        ...baseKey,
        assignedTo: override?.assignedTo ?? harnesses,
        ...(override?.budgetUsd !== undefined ? { budgetUsd: override.budgetUsd } : {}),
        ...(override?.health ? { health: override.health } : {}),
      }
      discoveredKeys.push(merged)
    }

    // Merge: discovered + manual, deduplicated by id
    const seen = new Set<string>()
    const result: Key[] = []
    for (const k of [...discoveredKeys, ...manualKeys]) {
      if (!seen.has(k.id)) {
        seen.add(k.id)
        result.push(k)
      }
    }

    return result.sort((a, b) => a.provider.localeCompare(b.provider))
  }

  // Manual add (user-input key not from a .env file)
  add(input: KeyInput): Key {
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const newKey: StoredKey = {
      id: generateId(),
      provider: input.provider,
      maskedValue: maskValue(input.value),
      encryptedValue: input.value,
      assignedTo: [],
      budgetUsd: input.budgetUsd,
      health: 'good',
      manuallyAdded: true,
    }
    stored.push(newKey)
    this.storage.write(KEYS_FILE, stored)
    this.audit.append({ who: 'admin', what: 'key:add', target: input.provider })
    const { encryptedValue: _, manuallyAdded: __, ...key } = newKey
    return key
  }

  update(id: string, partial: Partial<Key>): Key | undefined {
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const index = stored.findIndex((k) => k.id === id)
    if (index !== -1) {
      stored[index] = { ...stored[index], ...partial }
    } else {
      // Create an override entry for a discovered key
      stored.push({
        id,
        provider: partial.provider ?? 'unknown',
        maskedValue: partial.maskedValue ?? '••••',
        encryptedValue: '',
        assignedTo: partial.assignedTo ?? [],
        ...(partial.budgetUsd !== undefined ? { budgetUsd: partial.budgetUsd } : {}),
        health: partial.health ?? 'good',
      })
    }
    this.storage.write(KEYS_FILE, stored)
    return this.list().find((k) => k.id === id)
  }

  remove(id: string): boolean {
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const key = stored.find((k) => k.id === id)
    if (!key) return false
    const filtered = stored.filter((k) => k.id !== id)
    this.storage.write(KEYS_FILE, filtered)
    this.audit.append({ who: 'admin', what: 'key:remove', target: key.provider })
    return true
  }
}
