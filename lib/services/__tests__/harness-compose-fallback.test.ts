// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HarnessService } from '../harness'
import { Storage } from '../storage'
import { DockerService } from '../docker'
import { AuditService } from '../audit'
import { ConfigService } from '../config'
import fs from 'fs'
import path from 'path'
import os from 'os'

vi.mock('../docker')

// Regression: an overlay missing live composeFile/serviceName (e.g. container
// briefly undiscoverable) must still be restart/start/stop-able by falling back
// to the conventional standalone compose layout — otherwise the agent becomes
// unmanageable through Swarm Map ("no compose file configured").
describe('HarnessService lifecycle compose fallback', () => {
  let tmpDir: string
  let storage: Storage
  let docker: DockerService
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-fallback-'))
    storage = new Storage(tmpDir)
    docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)

    // Point the swarm-map data dir at the temp dir and lay down a standalone compose.
    storage.write('settings.json', { dataDir: tmpDir })
    const composePath = path.join(tmpDir, 'compose', 'gamma', 'docker-compose.yml')
    fs.mkdirSync(path.dirname(composePath), { recursive: true })
    fs.writeFileSync(composePath, 'services:\n  hermes-gamma:\n    image: x\n')

    // Overlay has NO composeFile / serviceName — the corrupted-record case.
    storage.write('harnesses.json', [{ id: 'h_gamma', name: 'gamma' }])
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('restart falls back to the conventional compose path', () => {
    service.restart('h_gamma', 'quick')
    const expected = path.join(tmpDir, 'compose', 'gamma', 'docker-compose.yml')
    expect(docker.restart).toHaveBeenCalledWith(expected, 'hermes-gamma', 'quick')
  })

  it('start falls back to the conventional compose path', () => {
    service.start('h_gamma')
    const expected = path.join(tmpDir, 'compose', 'gamma', 'docker-compose.yml')
    expect(docker.start).toHaveBeenCalledWith(expected, 'hermes-gamma')
  })

  it('stop falls back to the conventional compose path', () => {
    service.stop('h_gamma')
    const expected = path.join(tmpDir, 'compose', 'gamma', 'docker-compose.yml')
    expect(docker.stop).toHaveBeenCalledWith(expected, 'hermes-gamma')
  })

  it('still throws when no compose file exists anywhere', () => {
    storage.write('harnesses.json', [{ id: 'h_ghost', name: 'ghost' }])
    expect(() => service.restart('h_ghost', 'quick')).toThrow(/no compose file configured/)
  })
})
