import type { Harness, RestartMode } from '@/lib/types'
import type { Storage } from './storage'
import type { DockerService } from './docker'
import type { AuditService } from './audit'

const HARNESSES_FILE = 'harnesses.json'

export class HarnessService {
  constructor(
    private storage: Storage,
    private docker: DockerService,
    private audit: AuditService,
  ) {}

  list(): Harness[] {
    return this.storage.read<Harness[]>(HARNESSES_FILE, [])
  }

  get(id: string): Harness | undefined {
    return this.list().find((h) => h.id === id)
  }

  updateConfig(id: string, partial: Partial<Harness>): Harness | undefined {
    const harnesses = this.list()
    const index = harnesses.findIndex((h) => h.id === id)
    if (index === -1) return undefined
    harnesses[index] = { ...harnesses[index], ...partial }
    this.storage.write(HARNESSES_FILE, harnesses)
    return harnesses[index]
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
