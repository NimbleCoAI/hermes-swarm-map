// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DockerService } from '../docker'

// DockerService is shell-free: it invokes execFileSync/spawn with an argv array
// (see docker-injection.test.ts for the security property). These tests mock
// that surface and assert the argv, and that behavior (fail-loud rebuild sync,
// fire-and-forget restarts, the RestartCount regression) is preserved.
const mockExecFileSync = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  default: { execFileSync: mockExecFileSync, spawn: mockSpawn },
  execFileSync: mockExecFileSync,
  spawn: mockSpawn,
}))

// Join a [cmd, args] call into a single string for substring assertions.
const joined = (call: unknown[]) => [call[0], ...((call[1] as string[]) ?? [])].join(' ')

describe('DockerService', () => {
  let docker: DockerService

  beforeEach(() => {
    vi.clearAllMocks()
    // Default spawn mock returns a fake child process. `on` is needed because
    // purge mode chains the `up` on the build child's exit event.
    const fakeChild = { unref: vi.fn(), on: vi.fn() }
    mockSpawn.mockReturnValue(fakeChild)
    docker = new DockerService()
  })

  it('checks if docker is available', () => {
    mockExecFileSync.mockReturnValueOnce(Buffer.from('Docker version 24.0.0'))
    expect(docker.isAvailable()).toBe(true)
  })

  it('returns false when docker is not available', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('not found') })
    expect(docker.isAvailable()).toBe(false)
  })

  it('lists containers from compose file', () => {
    const jsonOutput = JSON.stringify([
      { Name: 'hermes-audrey-1', Service: 'audrey', State: 'running' },
      { Name: 'hermes-cryptid-1', Service: 'cryptid', State: 'exited' },
    ])
    mockExecFileSync.mockReturnValueOnce(Buffer.from(jsonOutput))

    const containers = docker.listContainers('/path/to/docker-compose.yml')
    expect(containers).toHaveLength(2)
    expect(containers[0]).toEqual({
      name: 'hermes-audrey-1',
      service: 'audrey',
      state: 'running',
    })
    // composeFile is passed as its own argv element — never spliced into a string
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['compose', '-f', '/path/to/docker-compose.yml', 'ps', '--format', 'json']),
      expect.any(Object),
    )
  })

  it('returns empty array when compose ps fails', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('no compose') })
    const containers = docker.listContainers('/bad/path.yml')
    expect(containers).toEqual([])
  })

  it('inspectState reads RestartCount from the top-level field, not .State', () => {
    // Regression: in `docker inspect`, RestartCount is a TOP-LEVEL field, not under
    // .State. A `{{.State.RestartCount}}` template errors out ("map has no entry for
    // key RestartCount"), so inspectState would catch the throw and return null —
    // making /api/harnesses/:id/health report EVERY agent "unhealthy/running:false".
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.join(' ').includes('.State.RestartCount')) {
        throw new Error('template: :1:45: map has no entry for key "RestartCount"')
      }
      return Buffer.from('true|running|3|2026-06-18T23:10:59Z')
    })

    const state = docker.inspectState('hermes-nimbleco')
    expect(state).not.toBeNull()
    expect(state).toEqual({
      running: true,
      status: 'running',
      restartCount: 3,
      startedAt: '2026-06-18T23:10:59Z',
    })
  })

  it('restarts a service in quick mode (fire-and-forget via spawn)', () => {
    docker.restart('/path/compose.yml', 'audrey', 'quick')
    expect(mockExecFileSync).not.toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-f', '/path/compose.yml', 'restart', 'audrey']),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(mockSpawn.mock.results[0].value.unref).toHaveBeenCalled()
  })

  it('restarts a service in rebuild mode (fire-and-forget via spawn)', () => {
    docker.restart('/path/compose.yml', 'audrey', 'rebuild')
    expect(mockExecFileSync).not.toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-f', '/path/compose.yml', 'up', '-d', '--build', '--force-recreate', 'audrey']),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    // unref() must be called so the process outlives the caller
    expect(mockSpawn.mock.results[0].value.unref).toHaveBeenCalled()
  })

  it('recreates a service in recreate mode (force-recreate, NO rebuild)', () => {
    docker.restart('/path/compose.yml', 'audrey', 'recreate')
    expect(mockExecFileSync).not.toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-f', '/path/compose.yml', 'up', '-d', '--force-recreate', 'audrey']),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    // recreate must NOT rebuild the image — it only reloads env_file / config
    const args = mockSpawn.mock.calls[0][1] as string[]
    expect(args).not.toContain('--build')
    expect(mockSpawn.mock.results[0].value.unref).toHaveBeenCalled()
  })

  it('restarts a service in purge mode: build then up, both via docker argv (no shell)', () => {
    docker.restart('/path/compose.yml', 'audrey', 'purge')
    expect(mockExecFileSync).not.toHaveBeenCalled()
    // No `sh -c` — the build step is a direct docker argv call.
    expect(mockSpawn).not.toHaveBeenCalledWith('sh', expect.anything(), expect.anything())
    expect(mockSpawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-f', '/path/compose.yml', 'build', '--no-cache', 'audrey']),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    // The `up` is chained on the build child's exit event.
    expect(mockSpawn.mock.results[0].value.on).toHaveBeenCalledWith('exit', expect.any(Function))
    expect(mockSpawn.mock.results[0].value.unref).toHaveBeenCalled()
  })

  describe('rebuild syncs the build source before building', () => {
    // Stub a clean, fast-forwardable git checkout. Each git call returns the
    // right value based on the subcommand (matched against the joined argv).
    function stubCleanGit(opts?: { dirty?: string; branch?: string; noUpstream?: boolean; nonFf?: boolean }) {
      const branch = opts?.branch ?? 'main'
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        const a = args.join(' ')
        if (a.includes('rev-parse --is-inside-work-tree')) return Buffer.from('true')
        if (a.includes('status --porcelain')) return Buffer.from(opts?.dirty ?? '')
        if (a.includes('rev-parse --abbrev-ref HEAD')) return Buffer.from(branch)
        if (a.includes('symbolic-full-name @{u}')) {
          if (opts?.noUpstream) throw new Error('no upstream')
          return Buffer.from(`origin/${branch}`)
        }
        if (a.includes('fetch')) return Buffer.from('')
        if (a.includes('merge --ff-only')) {
          if (opts?.nonFf) throw new Error('not possible to fast-forward')
          return Buffer.from('Updating')
        }
        if (a.includes('rev-parse --short HEAD')) return Buffer.from('abc1234')
        return Buffer.from('')
      })
    }

    it('fetches and fast-forwards the source, then builds', () => {
      stubCleanGit()
      docker.restart('/path/compose.yml', 'audrey', 'rebuild', undefined, '/src/hermes')
      const calls = mockExecFileSync.mock.calls.map(joined)
      expect(calls.some((c) => c.includes('git -C /src/hermes fetch'))).toBe(true)
      expect(calls.some((c) => c.includes('git -C /src/hermes merge --ff-only origin/main'))).toBe(true)
      // build still fires
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['--build', '--force-recreate', 'audrey']),
        expect.any(Object),
      )
    })

    it('FAILS LOUD and does NOT build when the source is dirty', () => {
      stubCleanGit({ dirty: ' M lib/foo.ts' })
      expect(() => docker.restart('/c.yml', 'audrey', 'rebuild', undefined, '/src/hermes')).toThrow(/uncommitted changes/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('FAILS LOUD and does NOT build when the source cannot fast-forward', () => {
      stubCleanGit({ nonFf: true })
      expect(() => docker.restart('/c.yml', 'audrey', 'rebuild', undefined, '/src/hermes')).toThrow(/cannot fast-forward|diverged/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('FAILS LOUD when the source has no upstream tracking branch', () => {
      stubCleanGit({ noUpstream: true })
      expect(() => docker.restart('/c.yml', 'audrey', 'rebuild', undefined, '/src/hermes')).toThrow(/no upstream/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('FAILS LOUD when the source is in detached HEAD', () => {
      stubCleanGit({ branch: 'HEAD' })
      expect(() => docker.restart('/c.yml', 'audrey', 'rebuild', undefined, '/src/hermes')).toThrow(/detached HEAD/)
      expect(mockSpawn).not.toHaveBeenCalled()
    })

    it('does NOT sync for non-build modes (quick/recreate)', () => {
      docker.restart('/c.yml', 'audrey', 'quick', undefined, '/src/hermes')
      const calls = mockExecFileSync.mock.calls.map(joined)
      expect(calls.some((c) => c.includes('git -C'))).toBe(false)
    })

    it('does NOT sync when no build source is provided (image-only harness)', () => {
      docker.restart('/c.yml', 'audrey', 'rebuild')
      const calls = mockExecFileSync.mock.calls.map(joined)
      expect(calls.some((c) => c.includes('git -C'))).toBe(false)
      expect(mockSpawn).toHaveBeenCalled()
    })
  })

  describe('start() — project + --env-file (Letta server bring-up)', () => {
    it('inserts --env-file as a top-level compose option before the subcommand', () => {
      docker.start('/repo/docker/letta-compose.yml', 'letta', 'letta', '/data/letta/.env')
      const argv = mockExecFileSync.mock.calls[0][1] as string[]
      // Order matters: `docker compose -p letta --env-file X -f Y up -d letta`.
      // --env-file must precede `up`, and -f must precede the service.
      const envIdx = argv.indexOf('--env-file')
      const upIdx = argv.indexOf('up')
      expect(argv[0]).toBe('compose')
      expect(argv.slice(0, envIdx)).toContain('letta') // -p letta present before --env-file
      expect(envIdx).toBeGreaterThan(-1)
      expect(argv[envIdx + 1]).toBe('/data/letta/.env')
      expect(envIdx).toBeLessThan(upIdx)
      expect(argv.slice(-3)).toEqual(['up', '-d', 'letta'])
    })

    it('omits --env-file entirely when none is passed', () => {
      docker.start('/c.yml', 'svc')
      const argv = mockExecFileSync.mock.calls[0][1] as string[]
      expect(argv).not.toContain('--env-file')
    })
  })
})
