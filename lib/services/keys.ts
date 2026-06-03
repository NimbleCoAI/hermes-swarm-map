import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import type { Key, KeyInput } from '@/lib/types'
import type { Storage } from './storage'
import type { AuditService } from './audit'
import { Encryption } from './encryption'

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

// --- Anthropic credential routing -------------------------------------------
// Anthropic accepts two credential formats that authenticate differently:
//   * Standard API keys (sk-ant-api*) → x-api-key header, which the SDK reads
//     from ANTHROPIC_API_KEY.
//   * Bearer-style tokens (sk-ant-oat* setup tokens, cc-* access tokens, JWT
//     eyJ*) → Authorization: Bearer, which the SDK reads from ANTHROPIC_TOKEN.
// The two must never both be set: the SDK auto-attaches x-api-key whenever
// ANTHROPIC_API_KEY is present — even alongside a Bearer token — producing a
// conflicting dual-header request the API rejects (HTTP 401). So a credential
// is written to exactly one of these vars and the other is cleared.
export const ANTHROPIC_ENV_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN'] as const

export function anthropicEnvVarForValue(value: string): 'ANTHROPIC_API_KEY' | 'ANTHROPIC_TOKEN' {
  const v = (value ?? '').trim()
  if (v.startsWith('sk-ant-api')) return 'ANTHROPIC_API_KEY'
  if (v.startsWith('sk-ant-') || v.startsWith('cc-') || v.startsWith('eyJ')) return 'ANTHROPIC_TOKEN'
  return 'ANTHROPIC_API_KEY'
}

// Set VAR=value in a .env body — replacing an existing line or appending one.
function upsertEnvVar(content: string, varName: string, value: string): string {
  const regex = new RegExp(`^${varName}=.*$`, 'm')
  if (regex.test(content)) return content.replace(regex, `${varName}=${value}`)
  return content.trimEnd() + `\n${varName}=${value}\n`
}

// Remove a VAR= line (if present) from a .env body.
function removeEnvVar(content: string, varName: string): string {
  return content.replace(new RegExp(`^${varName}=.*\\n?`, 'm'), '')
}

type ProviderPattern = {
  varPattern: RegExp
  provider: string
  valuePattern?: RegExp
}

const PROVIDER_PATTERNS: ProviderPattern[] = [
  { varPattern: /^ANTHROPIC_API_KEY$/i, provider: 'anthropic', valuePattern: /^sk-ant-/ },
  { varPattern: /^ANTHROPIC_TOKEN$/i, provider: 'anthropic', valuePattern: /^(sk-ant-oat|cc-|eyJ)/ },
  { varPattern: /^OPENAI_API_KEY$/i, provider: 'openai', valuePattern: /^sk-/ },
  { varPattern: /^GITHUB_TOKEN$|^GITHUB_PAT$/i, provider: 'github', valuePattern: /^gh[pso]_/ },
  { varPattern: /^MATTERMOST_TOKEN$/i, provider: 'mattermost' },
  { varPattern: /^TELEGRAM_BOT_TOKEN$/i, provider: 'telegram' },
  { varPattern: /^SIGNAL_ACCOUNT$/i, provider: 'signal' },
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

// Convert harness name to harness ID (matches harness.ts convention)
function nameToId(name: string): string {
  return 'h_' + name.replace(/-/g, '_')
}

// Convert harness ID back to name (h_seraph_doer → seraph-doer)
function idToName(id: string): string {
  return id.replace(/^h_/, '').replace(/_/g, '-')
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
// encryption is optional: if provided, values are encrypted before storing in the registry
function discoverKeys(harnessNames: string[], encryption?: Encryption): Map<string, { key: StoredKey; harnesses: string[] }> {
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
        const encryptedValue = encryption ? encryption.encrypt(value) : value
        const storedKey: StoredKey = {
          id: fpId,
          provider,
          maskedValue: maskValue(value),
          encryptedValue, // encrypted at rest; never exposed in API
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
  private encryption: Encryption

  constructor(
    private storage: Storage,
    private audit: AuditService,
    dataDir?: string,
  ) {
    // Use the storage directory as the data dir for the encryption key file
    const dir = dataDir ?? storage.getBaseDir()
    this.encryption = new Encryption(dir)
  }

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
    const registry = discoverKeys(names, this.encryption)
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
        assignedTo: override?.assignedTo ?? harnesses.map(nameToId),
        ...(override?.budgetUsd !== undefined ? { budgetUsd: override.budgetUsd } : {}),
        ...(override?.health ? { health: override.health } : {}),
        ...(override?.name ? { name: override.name } : {}),
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

  // Map provider to env var name
  private static PROVIDER_TO_VAR: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    github: 'GITHUB_TOKEN',
    mattermost: 'MATTERMOST_TOKEN',
    telegram: 'TELEGRAM_BOT_TOKEN',
    signal: 'SIGNAL_ACCOUNT',
    notion: 'NOTION_API_KEY',
    aws: 'AWS_ACCESS_KEY_ID',
    'aws-bedrock': 'AWS_BEARER_TOKEN_BEDROCK',
    'google-cloud': 'GOOGLE_CLOUD_API_KEY',
    brave: 'BRAVE_SEARCH_API_KEY',
    helius: 'HELIUS_API_KEY',
    coingecko: 'COINGECKO_API_KEY',
    dehashed: 'DEHASHED_API_KEY',
    opencorporates: 'OPENCORPORATES_API_KEY',
    capsolver: 'CAPSOLVER_API_KEY',
    'open-measures': 'OPEN_MEASURES_API_KEY',
    pexels: 'PEXELS_API_KEY',
  }

  // Manual add (user-input key not from a .env file)
  add(input: KeyInput & { assignedTo?: string[] }): Key {
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const newKey: StoredKey = {
      id: generateId(),
      provider: input.provider,
      ...(input.name ? { name: input.name } : {}),
      maskedValue: maskValue(input.value),
      encryptedValue: this.encryption.encrypt(input.value),
      assignedTo: input.assignedTo ?? [],
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

  // Resolve the env var a provider's credential is written to. Anthropic is
  // value-dependent (see anthropicEnvVarForValue); everything else is fixed.
  private resolveEnvVar(provider: string, value: string): string {
    if (provider === 'anthropic') return anthropicEnvVarForValue(value)
    return KeysService.PROVIDER_TO_VAR[provider] ?? `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`
  }

  writeKeyToEnv(harnessIdOrName: string, provider: string, value: string): void {
    const name = harnessIdOrName.startsWith('h_') ? idToName(harnessIdOrName) : harnessIdOrName
    const dataDir = agentDataDir(name)
    const envPath = path.join(dataDir, '.env')

    let content = ''
    try {
      content = fs.readFileSync(envPath, 'utf-8')
    } catch {
      // .env doesn't exist yet — will create
    }

    const varName = this.resolveEnvVar(provider, value)
    content = upsertEnvVar(content, varName, value)

    // Anthropic's credential belongs in exactly one var depending on its format;
    // clear the other so a stale value can't add a conflicting auth header.
    if (provider === 'anthropic') {
      for (const other of ANTHROPIC_ENV_VARS) {
        if (other !== varName) content = removeEnvVar(content, other)
      }
    }

    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(envPath, content, { mode: 0o600 })
  }

  removeKeyFromEnv(harnessIdOrName: string, provider: string): void {
    const name = harnessIdOrName.startsWith('h_') ? idToName(harnessIdOrName) : harnessIdOrName
    const dataDir = agentDataDir(name)
    const envPath = path.join(dataDir, '.env')

    try {
      let content = fs.readFileSync(envPath, 'utf-8')
      // Anthropic may have been written to either var; clear both.
      const vars = provider === 'anthropic'
        ? [...ANTHROPIC_ENV_VARS]
        : [KeysService.PROVIDER_TO_VAR[provider] ?? `${provider.toUpperCase().replace(/-/g, '_')}_API_KEY`]
      for (const v of vars) content = removeEnvVar(content, v)
      fs.writeFileSync(envPath, content, { mode: 0o600 })
    } catch {
      // .env doesn't exist, nothing to remove
    }
  }

  // Get the decrypted value for a key by id (internal use: restart flows, key injection)
  getDecryptedValue(id: string): string | undefined {
    // Check stored keys first
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const key = stored.find((k) => k.id === id)
    if (key?.encryptedValue) {
      try {
        return this.encryption.decrypt(key.encryptedValue)
      } catch {
        return key.encryptedValue
      }
    }

    // Fall back to live discovery — discovered keys aren't persisted to keys.json
    // until explicitly modified, but we can read the actual value from .env files
    const names = this.defaultHarnessNames()
    const registry = discoverKeys(names, this.encryption)
    const discovered = registry.get(id)
    if (discovered?.key.encryptedValue) {
      try {
        return this.encryption.decrypt(discovered.key.encryptedValue)
      } catch {
        return discovered.key.encryptedValue
      }
    }

    return undefined
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
        ...(partial.name ? { name: partial.name } : {}),
        health: partial.health ?? 'good',
      })
    }
    this.storage.write(KEYS_FILE, stored)
    return this.list().find((k) => k.id === id)
  }

  rotateValue(id: string, newValue: string, updates?: Partial<Key>): Key | undefined {
    // Read stored keys and deduplicate by ID (cleanup from prior bugs)
    const raw = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const seen = new Set<string>()
    const stored: StoredKey[] = []
    for (const k of raw) {
      if (!seen.has(k.id)) { seen.add(k.id); stored.push(k) }
    }

    let index = stored.findIndex((k) => k.id === id)

    // Key might be discovered (from .env scan) but not in stored file — look it up and add it
    if (index === -1) {
      const discovered = this.list().find((k) => k.id === id)
      if (!discovered) return undefined
      const decrypted = this.getDecryptedValue(id)
      stored.push({
        id: discovered.id,
        provider: discovered.provider,
        maskedValue: discovered.maskedValue,
        encryptedValue: decrypted ? this.encryption.encrypt(decrypted) : '',
        assignedTo: discovered.assignedTo,
        health: discovered.health,
        ...(discovered.name ? { name: discovered.name } : {}),
        ...(discovered.budgetUsd !== undefined ? { budgetUsd: discovered.budgetUsd } : {}),
      })
      index = stored.length - 1
    }

    const key = stored[index]
    const encryptedValue = this.encryption.encrypt(newValue)
    const newFpId = fingerprintId(newValue)

    // Determine final assignedTo (from updates or existing)
    const finalAssignedTo = updates?.assignedTo ?? key.assignedTo

    // Update stored entry with new value + fingerprint-based ID + any metadata updates
    stored[index] = {
      ...key,
      id: newFpId,
      encryptedValue,
      maskedValue: maskValue(newValue),
      assignedTo: finalAssignedTo,
      ...(updates?.name !== undefined ? { name: updates.name } : {}),
      ...(updates?.budgetUsd !== undefined ? { budgetUsd: updates.budgetUsd } : {}),
    }
    this.storage.write(KEYS_FILE, stored)

    // Write new value to all assigned harnesses' .env files
    for (const harnessId of finalAssignedTo) {
      this.writeKeyToEnv(harnessId, key.provider, newValue)
    }

    // Remove from harnesses that were unassigned
    if (updates?.assignedTo) {
      const removed = key.assignedTo.filter((h) => !updates.assignedTo!.includes(h))
      for (const harnessId of removed) {
        this.removeKeyFromEnv(harnessId, key.provider)
      }
    }

    this.audit.append({ who: 'admin', what: 'key:rotate', target: key.provider })
    return this.list().find((k) => k.id === newFpId)
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
