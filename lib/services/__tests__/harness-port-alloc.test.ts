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

// Keep port allocation deterministic regardless of any docker containers
// actually running on the host: nextAvailablePort scans `docker ps` via
// child_process.execSync, so stub it to an empty result.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return { ...actual, execSync: vi.fn(() => Buffer.from('')) }
})

const BASE_PORT = 8642
const PORT_STEP = 10

describe('HarnessService port allocation (#113)', () => {
  let tmpDir: string
  let storage: Storage
  let service: HarnessService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-portalloc-'))
    vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
    storage = new Storage(tmpDir)
    const docker = new DockerService()
    const audit = new AuditService(storage)
    const config = new ConfigService(storage)
    service = new HarnessService(storage, docker, audit, config)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('(a) createOverlay twice persists distinct apiPorts', async () => {
    storage.write('harnesses.json', [])

    const first = await service.createOverlay({ name: 'agent-one' })
    const second = await service.createOverlay({ name: 'agent-two' })

    // Both must carry a concrete apiPort...
    expect(typeof first.apiPort).toBe('number')
    expect(typeof second.apiPort).toBe('number')
    // ...and they must differ (the bug: both got BASE_PORT).
    expect(first.apiPort).not.toBe(second.apiPort)

    // The persisted overlays carry the same ports.
    const overlays = storage.read<any[]>('harnesses.json', [])
    const persistedPorts = overlays.map((h) => h.apiPort).filter((p) => typeof p === 'number')
    expect(new Set(persistedPorts).size).toBe(persistedPorts.length) // all unique
    expect(persistedPorts).toContain(first.apiPort)
    expect(persistedPorts).toContain(second.apiPort)
  })

  it('(b) a persisted apiPort is treated as reserved — next create skips it', async () => {
    // Pre-seed an overlay that already owns BASE_PORT but has NO live container
    // and NO compose file written yet (the exact gap that caused double-assign).
    storage.write('harnesses.json', [
      { id: 'h_seed', name: 'seed', apiPort: BASE_PORT },
    ])

    const created = await service.createOverlay({ name: 'fresh-agent' })

    expect(created.apiPort).toBeDefined()
    expect(created.apiPort).not.toBe(BASE_PORT)
    // Allocation walks in PORT_STEP increments from BASE_PORT.
    expect((created.apiPort! - BASE_PORT) % PORT_STEP).toBe(0)
  })

  it('(c) a colliding allocation fails loud rather than producing a stuck container', async () => {
    // An existing overlay owns BASE_PORT. Import a data dir whose .env hard-codes
    // the SAME port (API_SERVER_PORT). The import path honors the declared port,
    // so the fail-loud guard must refuse instead of silently writing a compose
    // that binds an already-claimed host port.
    storage.write('harnesses.json', [
      { id: 'h_taken', name: 'taken', apiPort: BASE_PORT },
    ])

    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-import-src-'))
    fs.writeFileSync(path.join(srcDir, 'SOUL.md'), '# Collider\nI collide.')
    fs.writeFileSync(
      path.join(srcDir, '.env'),
      `ANTHROPIC_API_KEY=sk-ant-test\nAPI_SERVER_PORT=${BASE_PORT}\n`,
    )
    fs.mkdirSync(path.join(srcDir, 'memories'))

    try {
      await expect(service.importFromDir(srcDir, 'collider')).rejects.toThrow(
        /already assigned/i,
      )
    } finally {
      fs.rmSync(srcDir, { recursive: true, force: true })
    }
  })
})
