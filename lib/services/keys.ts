import type { Key, KeyInput } from '@/lib/types'
import type { Storage } from './storage'
import type { AuditService } from './audit'
import crypto from 'crypto'

const KEYS_FILE = 'keys.json'

type StoredKey = Key & { encryptedValue: string }

function maskValue(value: string): string {
  if (value.length <= 8) return '••••'
  const prefix = value.slice(0, 4)
  const suffix = value.slice(-4)
  return `${prefix}…${suffix}`
}

function generateId(): string {
  return `k_${crypto.randomBytes(6).toString('hex')}`
}

export class KeysService {
  constructor(
    private storage: Storage,
    private audit: AuditService,
  ) {}

  list(): Key[] {
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    return stored.map(({ encryptedValue: _, ...key }) => key)
  }

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
    }
    stored.push(newKey)
    this.storage.write(KEYS_FILE, stored)
    this.audit.append({ who: 'admin', what: 'key:add', target: input.provider })
    const { encryptedValue: _, ...key } = newKey
    return key
  }

  update(id: string, partial: Partial<Key>): Key | undefined {
    const stored = this.storage.read<StoredKey[]>(KEYS_FILE, [])
    const index = stored.findIndex((k) => k.id === id)
    if (index === -1) return undefined
    stored[index] = { ...stored[index], ...partial }
    this.storage.write(KEYS_FILE, stored)
    const { encryptedValue: _, ...key } = stored[index]
    return key
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
