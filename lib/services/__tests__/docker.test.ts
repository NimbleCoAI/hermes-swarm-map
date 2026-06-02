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
})
