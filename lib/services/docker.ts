import { execSync } from 'child_process'
import type { RestartMode } from '@/lib/types'

type ContainerInfo = {
  name: string
  service: string
  state: string
}

export type ComposeProject = {
  name: string
  status: string
  configFiles: string[]
}

export type ContainerDetails = {
  name: string
  service: string
  state: string
  status: string
  ports: Array<{ published: number; target: number }>
  startedAt?: string
  composeFile?: string
  project?: string
}

export type ContainerStats = {
  cpu: number
  memMiB: number
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

  listComposeProjects(): ComposeProject[] {
    try {
      const output = execSync('docker compose ls --format json', {
        stdio: 'pipe',
        timeout: 10000,
      }).toString()
      const parsed = JSON.parse(output)
      const items = Array.isArray(parsed) ? parsed : [parsed]
      return items.map((p: Record<string, string>) => ({
        name: p.Name,
        status: p.Status,
        configFiles: p.ConfigFiles ? p.ConfigFiles.split(',').map((f) => f.trim()) : [],
      }))
    } catch {
      return []
    }
  }

  inspectContainers(projectName: string): ContainerDetails[] {
    try {
      const output = execSync(
        `docker compose -p ${projectName} ps --format json`,
        { stdio: 'pipe', timeout: 10000 }
      ).toString()

      // docker compose ps outputs one JSON object per line (not a JSON array)
      const lines = output.trim().split('\n').filter((l) => l.trim())
      const items = lines.map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      }).filter(Boolean)

      return items.map((c: Record<string, unknown>) => {
        const publishers = (c.Publishers as Array<Record<string, number>> | null) ?? []
        const ports = publishers
          .filter((p) => p.PublishedPort > 0)
          .map((p) => ({ published: p.PublishedPort, target: p.TargetPort }))

        // Extract config files from Labels if available
        const labels = c.Labels as string | null
        let composeFile: string | undefined
        let project: string | undefined
        if (labels) {
          const cfMatch = labels.match(/com\.docker\.compose\.project\.config_files=([^,]+)/)
          if (cfMatch) composeFile = cfMatch[1]
          const projMatch = labels.match(/com\.docker\.compose\.project=([^,]+)/)
          if (projMatch) project = projMatch[1]
        }

        return {
          name: c.Name as string,
          service: c.Service as string,
          state: c.State as string,
          status: c.Status as string,
          ports,
          composeFile,
          project,
        }
      })
    } catch {
      return []
    }
  }

  getContainerStats(containerName: string): ContainerStats {
    try {
      const output = execSync(
        `docker stats ${containerName} --no-stream --format '{{json .}}'`,
        { stdio: 'pipe', timeout: 10000 }
      ).toString().trim()

      const parsed = JSON.parse(output)
      const cpuStr: string = parsed.CPUPerc ?? '0%'
      const memStr: string = parsed.MemUsage ?? '0MiB / 0GiB'

      const cpu = parseFloat(cpuStr.replace('%', '')) || 0
      const memMatch = memStr.match(/^([\d.]+)(\w+)/)
      let memMiB = 0
      if (memMatch) {
        const val = parseFloat(memMatch[1])
        const unit = memMatch[2].toUpperCase()
        if (unit === 'GIB') memMiB = val * 1024
        else if (unit === 'MIB') memMiB = val
        else if (unit === 'KIB') memMiB = val / 1024
        else memMiB = val
      }

      return { cpu, memMiB: Math.round(memMiB) }
    } catch {
      return { cpu: 0, memMiB: 0 }
    }
  }

  getContainerDetails(containerName: string): { startedAt?: string } {
    try {
      const output = execSync(
        `docker inspect ${containerName} --format '{{json .State}}'`,
        { stdio: 'pipe', timeout: 10000 }
      ).toString().trim()
      const state = JSON.parse(output)
      return { startedAt: state.StartedAt }
    } catch {
      return {}
    }
  }

  restart(composeFile: string, service: string, mode: RestartMode, projectName?: string): void {
    const opts = { stdio: 'pipe' as const, timeout: 120000 }
    const projectFlag = projectName ? `-p ${projectName} ` : ''

    switch (mode) {
      case 'quick':
        execSync(`docker compose ${projectFlag}-f ${composeFile} restart ${service}`, opts)
        break
      case 'rebuild':
        execSync(
          `docker compose ${projectFlag}-f ${composeFile} up -d --build --force-recreate ${service}`,
          opts
        )
        break
      case 'purge':
        execSync(
          `docker compose ${projectFlag}-f ${composeFile} build --no-cache ${service}`,
          opts
        )
        execSync(
          `docker compose ${projectFlag}-f ${composeFile} up -d --force-recreate ${service}`,
          opts
        )
        break
    }
  }

  start(composeFile: string, service: string, projectName?: string): void {
    const projectFlag = projectName ? `-p ${projectName} ` : ''
    execSync(`docker compose ${projectFlag}-f ${composeFile} up -d ${service}`, {
      stdio: 'pipe',
      timeout: 60000,
    })
  }

  stop(composeFile: string, service: string, projectName?: string): void {
    const projectFlag = projectName ? `-p ${projectName} ` : ''
    execSync(`docker compose ${projectFlag}-f ${composeFile} stop ${service}`, {
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
