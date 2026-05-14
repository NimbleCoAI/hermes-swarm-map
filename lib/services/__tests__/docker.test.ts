// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DockerService } from '../docker'

const mockExecSync = vi.hoisted(() => vi.fn())

vi.mock('child_process', () => ({
  default: { execSync: mockExecSync },
  execSync: mockExecSync,
}))

describe('DockerService', () => {
  let docker: DockerService

  beforeEach(() => {
    vi.clearAllMocks()
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

  it('restarts a service in quick mode', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(''))
    docker.restart('/path/compose.yml', 'audrey', 'quick')
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('docker compose -f /path/compose.yml restart audrey'),
      expect.any(Object)
    )
  })

  it('restarts a service in rebuild mode', () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(''))
    docker.restart('/path/compose.yml', 'audrey', 'rebuild')
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('docker compose -f /path/compose.yml up -d --build --force-recreate audrey'),
      expect.any(Object)
    )
  })

  it('restarts a service in purge mode', () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from(''))
      .mockReturnValueOnce(Buffer.from(''))
    docker.restart('/path/compose.yml', 'audrey', 'purge')
    expect(mockExecSync).toHaveBeenCalledTimes(2)
  })
})
