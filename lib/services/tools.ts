import type { Tool } from '@/lib/types'
import type { Storage } from './storage'

const TOOLS_FILE = 'tools.json'

export class ToolsService {
  constructor(private storage: Storage) {}

  list(): Tool[] {
    return this.storage.read<Tool[]>(TOOLS_FILE, [])
  }

  update(id: string, partial: Partial<Tool>): Tool | undefined {
    const tools = this.list()
    const index = tools.findIndex((t) => t.id === id)
    if (index === -1) return undefined
    tools[index] = { ...tools[index], ...partial }
    this.storage.write(TOOLS_FILE, tools)
    return tools[index]
  }
}
