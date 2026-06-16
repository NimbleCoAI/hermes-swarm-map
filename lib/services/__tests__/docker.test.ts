// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DockerService } from '../docker'

const mockExecSync = vi.hoisted(() => vi.fn())
const mockSpawn = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  default: { execSync: mockExecSync, spawn: mockSpawn },
  execSync: mockExecSync,
  spawn: mockSpawn,
}))

describe('DockerService', () => {
  let docker: DockerService

  beforeEach(() => {
    vi.clearAllMocks()
    // Default spawn mock returns a fake child process
    const fakeChild = { unref: vi.fn() }
    mockSpawn.mockReturnValue(fakeChild)
    docker = new DockerService()
  })

  it('checks if docker is available', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from('Docker version 24.0.0'))
    expect(docker.isAvailable()).toBe(true)
  })

  it('returns false when docker is not available', () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error('not found') })
    expect(docker.isAvailable()).toBe(false)
  })

  it('lists containers from compose file', () => {
    const jsonOutput = JSON.stringify([
      { Name: 'hermes-audrey-1', Service: 'audrey', State: 'running' },
      { Name: 'hermes-cryptid-1', Service: 'cryptid', State: 'exited' },
    ])
    mockExecSync.mockReturnValueOnce(Buffer.from(jsonOutput))

    const containers = docker.listContainers('/path/to/docker-compose.yml')
    expect(containers).toHaveLength(2)
    expect(containers[0]).toEqual({
      name: 'hermes-audrey-1',
      service: 'audrey',
      state: 'running',
    })
  })

  it('returns empty array when compose ps fails', () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error('no compose') })
    const containers = docker.listContainers('/bad/path.yml')
    expect(containers).toEqual([])
  })

  it('restarts a service in quick mode (fire-and-forget via spawn)', () => {
    docker.restart('/path/compose.yml', 'audrey', 'quick')
    expect(mockExecSync).not.toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      'docker',
      expect.arrayContaining(['-f', '/path/compose.yml', 'restart', 'audrey']),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(mockSpawn.mock.results[0].value.unref).toHaveBeenCalled()
  })

  it('restarts a service in rebuild mode (fire-and-forget via spawn)', () => {
    docker.restart('/path/compose.yml', 'audrey', 'rebuild')
    expect(mockExecSync).not.toHaveBeenCalled()
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
    expect(mockExecSync).not.toHaveBeenCalled()
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

  it('restarts a service in purge mode (fire-and-forget via spawn)', () => {
    docker.restart('/path/compose.yml', 'audrey', 'purge')
    expect(mockExecSync).not.toHaveBeenCalled()
    expect(mockSpawn).toHaveBeenCalledWith(
      'sh',
      expect.arrayContaining(['-c', expect.stringContaining('--no-cache audrey')]),
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(mockSpawn.mock.results[0].value.unref).toHaveBeenCalled()
  })

  describe('rebuild syncs the build source before building', () => {
    // Stub a clean, fast-forwardable git checkout. Each git call returns the
    // right value based on the subcommand.
    function stubCleanGit(opts?: { dirty?: string; branch?: string; noUpstream?: boolean; nonFf?: boolean }) {
      const branch = opts?.branch ?? 'main'
      mockExecSync.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse --is-inside-work-tree')) return Buffer.from('true')
        if (cmd.includes('status --porcelain')) return Buffer.from(opts?.dirty ?? '')
        if (cmd.includes('rev-parse --abbrev-ref HEAD')) return Buffer.from(branch)
        if (cmd.includes('symbolic-full-name @{u}')) {
          if (opts?.noUpstream) throw new Error('no upstream')
          return Buffer.from(`origin/${branch}`)
        }
        if (cmd.includes('fetch')) return Buffer.from('')
        if (cmd.includes('merge --ff-only')) {
          if (opts?.nonFf) throw new Error('not possible to fast-forward')
          return Buffer.from('Updating')
        }
        if (cmd.includes('rev-parse --short HEAD')) return Buffer.from('abc1234')
        return Buffer.from('')
      })
    }

    it('fetches and fast-forwards the source, then builds', () => {
      stubCleanGit()
      docker.restart('/path/compose.yml', 'audrey', 'rebuild', undefined, '/src/hermes')
      const calls = mockExecSync.mock.calls.map((c) => c[0] as string)
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
      const calls = mockExecSync.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes('git -C'))).toBe(false)
    })

    it('does NOT sync when no build source is provided (image-only harness)', () => {
      docker.restart('/c.yml', 'audrey', 'rebuild')
      const calls = mockExecSync.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes('git -C'))).toBe(false)
      expect(mockSpawn).toHaveBeenCalled()
    })
  })
})
