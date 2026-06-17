// @vitest-environment node
//
// Route-level integration test for POST /api/setup/deploy. Docker, the services
// singleton, baseline-template install, and os.homedir are mocked; everything
// else (the route logic, .env + compose templating, fs writes) runs for real
// against temp dirs. This exercises the full Phase 1 wiring end-to-end in-process
// — the only thing not covered is the actual `docker compose up` (no Docker here).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

const h = vi.hoisted(() => ({
  tmpHome: '',
  tmpData: '',
  getDecryptedValue: vi.fn((id: string) => (id === 'k_known' ? 'sk-ant-api-REALVALUE123' : undefined)),
  list: vi.fn(() => [{ id: 'k_known', provider: 'anthropic', assignedTo: [], maskedValue: 'sk-a…123', health: 'good' }]),
  update: vi.fn(),
  add: vi.fn(),
  createOverlay: vi.fn(async () => ({ id: 'h_matilde' })),
}))

vi.mock('child_process', () => ({ execSync: vi.fn(() => Buffer.from('')) }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const homedir = () => h.tmpHome
  return { ...actual, homedir, default: { ...actual, homedir } }
})

vi.mock('@/lib/services/templates', () => ({ installBaselineTemplates: vi.fn(async () => []) }))

vi.mock('@/lib/services', () => ({
  services: {
    docker: { isAvailable: () => true, pullImage: () => ({ ok: true }), healthCheck: () => false },
    config: { getSettings: () => ({ useLocalBuild: false, defaultImage: 'ghcr.io/x:latest', dataDir: h.tmpData }) },
    keys: { getDecryptedValue: h.getDecryptedValue, list: h.list, update: h.update, add: h.add },
    harness: { createOverlay: h.createOverlay },
  },
}))

import { POST } from '@/app/api/setup/deploy/route'

function deploy(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/setup/deploy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

describe('POST /api/setup/deploy — Phase 1 wiring', () => {
  beforeEach(() => {
    h.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-home-'))
    h.tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-data-'))
    h.getDecryptedValue.mockClear()
    h.update.mockClear()
    h.add.mockClear()
    h.createOverlay.mockClear()
    h.createOverlay.mockResolvedValue({ id: 'h_matilde' })
  })

  afterEach(() => {
    fs.rmSync(h.tmpHome, { recursive: true, force: true })
    fs.rmSync(h.tmpData, { recursive: true, force: true })
  })

  it('1A: resolves an existing key server-side, writes it to .env, records assignment', async () => {
    const res = await deploy({
      name: 'matilde', provider: 'anthropic', primaryModel: 'claude-opus-4-6',
      tier: 'individual', existingKeyId: 'k_known',
    })
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.harnessId).toBe('h_matilde')
    expect(h.getDecryptedValue).toHaveBeenCalledWith('k_known')

    const env = fs.readFileSync(path.join(h.tmpHome, '.hermes-matilde', '.env'), 'utf-8')
    expect(env).toContain('ANTHROPIC_API_KEY=sk-ant-api-REALVALUE123')

    expect(h.update).toHaveBeenCalledWith('k_known', { assignedTo: ['h_matilde'] })
  })

  it('1A: rejects an unknown existing key id', async () => {
    const res = await deploy({
      name: 'x', provider: 'anthropic', primaryModel: 'claude-opus-4-6', existingKeyId: 'k_missing',
    })
    expect(res.status).toBe(400)
    expect((await res.json()).ok).toBe(false)
  })

  it('1A: saves a freshly-pasted key to the registry when asked', async () => {
    await deploy({
      name: 'fresh', provider: 'anthropic', primaryModel: 'claude-opus-4-6',
      llmKey: 'sk-ant-api-PASTED', saveKeyToRegistry: true,
    })
    expect(h.add).toHaveBeenCalledWith({ provider: 'anthropic', value: 'sk-ant-api-PASTED', assignedTo: ['h_matilde'] })
  })

  it('1B: bundled ollama emits the sidecar compose + sidecar OLLAMA_BASE_URL', async () => {
    await deploy({
      name: 'sci', provider: 'ollama', primaryModel: 'qwen2.5:0.5b', bundledOllama: true,
    })
    const compose = fs.readFileSync(path.join(h.tmpData, 'compose', 'sci', 'docker-compose.yml'), 'utf-8')
    expect(compose).toContain('ollama-sci:')
    expect(compose).toContain('qwen2.5:0.5b')

    const env = fs.readFileSync(path.join(h.tmpHome, '.hermes-sci', '.env'), 'utf-8')
    expect(env).toContain('OLLAMA_BASE_URL=http://ollama-sci:11434/v1')
  })

  it('1B: host ollama (default) points at host.docker.internal and adds no sidecar', async () => {
    await deploy({ name: 'host', provider: 'ollama', primaryModel: 'qwen3:8b' })
    const compose = fs.readFileSync(path.join(h.tmpData, 'compose', 'host', 'docker-compose.yml'), 'utf-8')
    expect(compose).not.toContain('ollama-host:')
    const env = fs.readFileSync(path.join(h.tmpHome, '.hermes-host', '.env'), 'utf-8')
    expect(env).toContain('OLLAMA_BASE_URL=http://host.docker.internal:11434/v1')
  })
})
