import type { MemoryScope } from '@/lib/types'
import type { Storage } from './storage'

const MEMORY_FILE = 'memory-scopes.json'

export class MemoryService {
  constructor(private storage: Storage) {}

  list(): MemoryScope[] {
    return this.storage.read<MemoryScope[]>(MEMORY_FILE, [])
  }
}
