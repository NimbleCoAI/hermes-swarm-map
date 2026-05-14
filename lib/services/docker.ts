import { execSync } from 'child_process'
import type { RestartMode } from '@/lib/types'

type ContainerInfo = {
  name: string
  service: string
  state: string
}

export class DockerService {
  isAvailable(): boolean {
    try {
      execSync('docker version', { stdio: 'pipe', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  listContainers(composeFile: string): ContainerInfo[] {
    try {
      const output = execSync(
        `docker compose -f ${composeFile} ps --format json`,
        { stdio: 'pipe', timeout: 10000 }
      ).toString()

      const parsed = JSON.parse(output)
      const items = Array.isArray(parsed) ? parsed : [parsed]

      return items.map((c: Record<string, string>) => ({
        name: c.Name,
        service: c.Service,
        state: c.State,
      }))
    } catch {
      return []
    }
  }

  restart(composeFile: string, service: string, mode: RestartMode): void {
    const opts = { stdio: 'pipe' as const, timeout: 120000 }

    switch (mode) {
      case 'quick':
        execSync(`docker compose -f ${composeFile} restart ${service}`, opts)
        break
      case 'rebuild':
        execSync(
          `docker compose -f ${composeFile} up -d --build --force-recreate ${service}`,
          opts
        )
        break
      case 'purge':
        execSync(
          `docker compose -f ${composeFile} build --no-cache ${service}`,
          opts
        )
        execSync(
          `docker compose -f ${composeFile} up -d --force-recreate ${service}`,
          opts
        )
        break
    }
  }

  start(composeFile: string, service: string): void {
    execSync(`docker compose -f ${composeFile} up -d ${service}`, {
      stdio: 'pipe',
      timeout: 60000,
    })
  }

  stop(composeFile: string, service: string): void {
    execSync(`docker compose -f ${composeFile} stop ${service}`, {
      stdio: 'pipe',
      timeout: 30000,
    })
  }

  getLogs(composeFile: string, service: string, lines: number = 50): string {
    try {
      return execSync(
        `docker compose -f ${composeFile} logs --tail=${lines} ${service}`,
        { stdio: 'pipe', timeout: 10000 }
      ).toString()
    } catch {
      return ''
    }
  }
}
