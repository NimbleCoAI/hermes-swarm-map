import type { AuditEntry } from '@/lib/types'
import type { Storage } from './storage'

const AUDIT_FILE = 'audit.jsonl'

type AuditInput = {
  who: string
  what: string
  target: string
  meta?: Record<string, unknown>
}

type AuditQuery = {
  who?: string
  what?: string
  since?: number
}

export class AuditService {
  constructor(private storage: Storage) {}

  append(input: AuditInput): void {
    const entry: AuditEntry = {
      ts: Date.now(),
      who: input.who,
      what: input.what,
      target: input.target,
      meta: input.meta,
    }
    this.storage.appendLine(AUDIT_FILE, entry)
  }

  query(filters: AuditQuery): AuditEntry[] {
    let entries = this.storage.readLines<AuditEntry>(AUDIT_FILE)
    if (filters.who) {
      entries = entries.filter((e) => e.who === filters.who)
    }
    if (filters.what) {
      entries = entries.filter((e) => e.what === filters.what)
    }
    if (filters.since) {
      entries = entries.filter((e) => e.ts >= filters.since)
    }
    return entries.reverse()
  }
}
