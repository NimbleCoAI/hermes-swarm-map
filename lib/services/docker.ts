import { execFileSync, spawn } from 'child_process'
import type { RestartMode } from '@/lib/types'

// SECURITY: every subprocess in this file is invoked via execFileSync/spawn with
// an argv ARRAY and no shell. Never reintroduce a string command run through
// /bin/sh (execSync, `sh -c`, exec) — settings-derived values (composeFile,
// image, hermesDir, service) reach these calls and a shell would make any
// metacharacter in them an injection point (findings F1–F5, 2026-07 review).

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
      execFileSync('docker', ['version'], { stdio: 'pipe', timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  listContainers(composeFile: string): ContainerInfo[] {
    try {
      const output = execFileSync(
        'docker',
        ['compose', '-f', composeFile, 'ps', '--format', 'json'],
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
      const output = execFileSync('docker', ['compose', 'ls', '--format', 'json'], {
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
      const output = execFileSync(
        'docker',
        ['compose', '-p', projectName, 'ps', '--format', 'json'],
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

  // Get stats for ALL containers in one call (avoids per-container 10s penalty)
  getAllContainerStats(): Record<string, ContainerStats> {
    try {
      const output = execFileSync(
        'docker',
        ['stats', '--no-stream', '--format', '{{json .}}'],
        { stdio: 'pipe', timeout: 15000 }
      ).toString().trim()

      const result: Record<string, ContainerStats> = {}
      for (const line of output.split('\n').filter((l) => l.trim())) {
        try {
          const parsed = JSON.parse(line)
          const name: string = parsed.Name ?? ''
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

          result[name] = { cpu, memMiB: Math.round(memMiB) }
        } catch {
          // skip unparseable lines
        }
      }
      return result
    } catch {
      return {}
    }
  }

  getContainerDetails(containerName: string): { startedAt?: string } {
    try {
      const output = execFileSync(
        'docker',
        ['inspect', containerName, '--format', '{{json .State}}'],
        { stdio: 'pipe', timeout: 10000 }
      ).toString().trim()
      const state = JSON.parse(output)
      return { startedAt: state.StartedAt }
    } catch {
      return {}
    }
  }

  /**
   * Bring a local build-source checkout up to the code it's SUPPOSED to build
   * before a `--build` reads it. Without this, a rebuild silently ships
   * whatever happens to be checked out — which already burned us once when a
   * checkout sat 1 commit behind main and a rebuild shipped stale code.
   *
   * Behavior (fail loud over ship stale):
   *   - not a git repo            → throw
   *   - dirty working tree        → throw (don't stash/discard someone's WIP)
   *   - no upstream tracking ref  → throw
   *   - can't fast-forward        → throw (diverged / detached — needs a human)
   *   - otherwise                 → fetch + `merge --ff-only @{u}`
   *
   * Returns the ref it synced to and the commit it will build from, for logging.
   */
  syncBuildSource(sourceDir: string): { branch: string; commit: string; upstream: string } {
    const git = (args: string[]) =>
      execFileSync('git', ['-C', sourceDir, ...args], { stdio: 'pipe', timeout: 120000 })
        .toString()
        .trim()

    // Must be a git work tree.
    try {
      if (git(['rev-parse', '--is-inside-work-tree']) !== 'true') {
        throw new Error('not a git work tree')
      }
    } catch (err) {
      throw new Error(
        `rebuild: build source ${sourceDir} is not a git repo — refusing to build (would ship un-synced code). ${err instanceof Error ? err.message : ''}`,
      )
    }

    // Refuse to build over uncommitted local changes — could ship un-pushed
    // edits, and a stash here could silently drop someone's WIP.
    const dirty = git(['status', '--porcelain'])
    if (dirty) {
      throw new Error(
        `rebuild: build source ${sourceDir} has uncommitted changes — refusing to build (would ship un-synced code). Commit/stash/clean it, then rebuild.`,
      )
    }

    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    if (branch === 'HEAD') {
      throw new Error(
        `rebuild: build source ${sourceDir} is in detached HEAD — refusing to build. Check out the intended branch, then rebuild.`,
      )
    }

    // Resolve the configured upstream tracking ref (e.g. origin/main).
    let upstream: string
    try {
      upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    } catch {
      throw new Error(
        `rebuild: build source ${sourceDir} (branch ${branch}) has no upstream tracking branch — refusing to build. Set one with \`git branch --set-upstream-to\`, then rebuild.`,
      )
    }

    // Fetch then fast-forward only. A non-ff (diverged history) fails loud.
    git(['fetch'])
    try {
      git(['merge', '--ff-only', upstream])
    } catch {
      throw new Error(
        `rebuild: build source ${sourceDir} (branch ${branch}) cannot fast-forward to ${upstream} — local history has diverged. Refusing to build. Reconcile manually, then rebuild.`,
      )
    }

    const commit = git(['rev-parse', '--short', 'HEAD'])
    return { branch, commit, upstream }
  }

  restart(composeFile: string, service: string, mode: RestartMode, projectName?: string, buildSource?: string | null): void {
    const projArgs = projectName ? ['-p', projectName] : []

    // For modes that run `--build`, sync the local source to the code it's
    // supposed to build FIRST. Throws (fail loud) rather than shipping stale.
    if ((mode === 'rebuild' || mode === 'purge') && buildSource) {
      const synced = this.syncBuildSource(buildSource)
      // eslint-disable-next-line no-console
      console.log(
        `[rebuild] ${service}: building ${buildSource} @ ${synced.branch} ${synced.commit} (synced to ${synced.upstream})`,
      )
    }

    const detach = (args: string[]) => {
      const child = spawn('docker', args, { stdio: 'ignore', detached: true })
      child.unref()
      return child
    }

    switch (mode) {
      case 'quick': {
        detach(['compose', ...projArgs, '-f', composeFile, 'restart', service])
        break
      }
      case 'recreate': {
        // Recreate the container WITHOUT rebuilding the image — the correct
        // primitive for env_file changes (e.g. rotated API keys), which a plain
        // `restart` would not reload. Fast; no image build.
        detach(['compose', ...projArgs, '-f', composeFile, 'up', '-d', '--force-recreate', service])
        break
      }
      case 'rebuild': {
        // Fire-and-forget: Docker builds can exceed any reasonable timeout.
        // The container will come up on its own when the build finishes.
        detach(['compose', ...projArgs, '-f', composeFile, 'up', '-d', '--build', '--force-recreate', service])
        break
      }
      case 'purge': {
        // Two-step rebuild: build --no-cache, THEN bring up — sequenced without a
        // shell by chaining on the build process's exit (only up on success).
        const buildArgs = ['compose', ...projArgs, '-f', composeFile, 'build', '--no-cache', service]
        const upArgs = ['compose', ...projArgs, '-f', composeFile, 'up', '-d', '--force-recreate', service]
        const build = spawn('docker', buildArgs, { stdio: 'ignore', detached: true })
        build.on('exit', (code) => {
          if (code === 0) {
            const up = spawn('docker', upArgs, { stdio: 'ignore', detached: true })
            up.unref()
          }
        })
        build.unref()
        break
      }
    }
  }

  start(composeFile: string, service: string, projectName?: string, envFile?: string): void {
    const projArgs = projectName ? ['-p', projectName] : []
    // `--env-file` is a top-level compose option (before the subcommand). Used by
    // the Letta server bring-up to inject server-wide provider keys from a
    // 0600 .env without mutating this process's environment.
    const envArgs = envFile ? ['--env-file', envFile] : []
    execFileSync('docker', ['compose', ...projArgs, ...envArgs, '-f', composeFile, 'up', '-d', service], {
      stdio: 'pipe',
      timeout: 60000,
    })
  }

  stop(composeFile: string, service: string, projectName?: string): void {
    const projArgs = projectName ? ['-p', projectName] : []
    execFileSync('docker', ['compose', ...projArgs, '-f', composeFile, 'stop', service], {
      stdio: 'pipe',
      timeout: 30000,
    })
  }

  pullImage(image: string): { ok: boolean; error?: string } {
    try {
      execFileSync('docker', ['pull', image], { stdio: 'pipe', timeout: 300000 })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Pull failed' }
    }
  }

  healthCheck(url: string, timeoutMs: number = 30000): boolean {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        execFileSync('curl', ['-sf', url], { stdio: 'pipe', timeout: 5000 })
        return true
      } catch {
        execFileSync('sleep', ['2'], { stdio: 'pipe' })
      }
    }
    return false
  }

  /**
   * Low-level container state for canary checks after a recreate. Returns null
   * if the container doesn't exist (e.g. mid-recreate or never started).
   */
  inspectState(service: string): { running: boolean; status: string; restartCount: number; startedAt: string } | null {
    try {
      // NOTE: RestartCount is a TOP-LEVEL field in `docker inspect`, not under .State.
      // `{{.State.RestartCount}}` errors the whole template → execFileSync throws → this
      // returns null → /api/harnesses/:id/health reports every agent unhealthy.
      const out = execFileSync(
        'docker',
        ['inspect', service, '--format', '{{.State.Running}}|{{.State.Status}}|{{.RestartCount}}|{{.State.StartedAt}}'],
        { stdio: 'pipe', timeout: 5000 },
      ).toString().trim()
      const [running, status, rc, startedAt] = out.split('|')
      return { running: running === 'true', status: status || 'unknown', restartCount: parseInt(rc, 10) || 0, startedAt: startedAt || '' }
    } catch {
      return null
    }
  }

  getLogs(composeFile: string, service: string, lines: number = 50): string {
    try {
      return execFileSync(
        'docker',
        ['compose', '-f', composeFile, 'logs', `--tail=${lines}`, service],
        { stdio: 'pipe', timeout: 10000 }
      ).toString()
    } catch {
      return ''
    }
  }
}
