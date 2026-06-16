// @vitest-environment node
/**
 * Tests for PUT /api/harnesses/:id/models.
 *
 * The PUT route writes the model cascade into the agent's config.yaml and the
 * agent restarts onto it. The guard rejects (a) an empty model id, and (b) a
 * model whose provider has NO configured credential for this agent — which would
 * crash-loop the agent on restart. It validates provider-credential PRESENCE
 * (read from the agent's .env), NOT catalog membership, and fails open on any
 * uncertainty so a valid config is never blocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'

vi.mock('@/lib/services', () => ({
  services: {
    harness: {
      get: vi.fn(() => ({ id: 'h_test', name: 'test', serviceName: 'hermes-test' })),
      updateConfig: vi.fn(),
    },
  },
}))

// readAgentEnvVarNames returns the provider keys configured for this agent.
// Default fixture: the agent has an Anthropic key only. Individual tests
// override it to exercise the credential-presence guard.
const mockEnvVars = vi.fn(() => new Set<string>(['ANTHROPIC_API_KEY']))

vi.mock('@/lib/services/harness', () => ({
  guessDataDir: vi.fn(() => '/tmp/hermes-test-data'),
  readModelConfig: vi.fn(() => []),
  readModelProvider: vi.fn(() => ''),
  readFallbackProviders: vi.fn(() => []),
  readAgentEnvVarNames: vi.fn(() => mockEnvVars()),
}))

import { PUT } from './route'
import { services } from '@/lib/services'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/harnesses/h_test/models', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('Models API — PUT validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEnvVars.mockReturnValue(new Set<string>(['ANTHROPIC_API_KEY']))
    // Pretend config.yaml exists and is writable; capture writes in-memory.
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      'model:\n  provider: anthropic\n  default: claude-sonnet-4-6\n' as never
    )
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('accepts a model whose provider has a configured key and writes config.yaml (200)', async () => {
    // claude-opus-4-8 is NOT in the suggestions catalog — must still pass.
    const body = { provider: 'anthropic', cascade: ['claude-opus-4-8'] }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(fs.writeFileSync).toHaveBeenCalled()
    expect(services.harness.updateConfig).toHaveBeenCalled()
  })

  it('rejects a provider with no configured credential (400) without writing', async () => {
    // Agent has ANTHROPIC_API_KEY only — pushing an openrouter model crash-loops it.
    const body = { provider: 'openrouter', cascade: ['moonshotai/kimi-k2.7-code'] }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('moonshotai/kimi-k2.7-code')
    expect(json.error).toContain('openrouter')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
  })

  it('rejects an un-serviceable provider in the fallback_providers shape (400)', async () => {
    mockEnvVars.mockReturnValue(new Set<string>(['ANTHROPIC_API_KEY'])) // no OPENAI_API_KEY
    const body = {
      fallback_providers: [
        { provider: 'anthropic', model: 'claude-opus-4-8' }, // serviceable
        { provider: 'openai', model: 'gpt-5' }, // no key → un-serviceable
      ],
    }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('gpt-5')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('accepts ollama with no key (local provider, 200)', async () => {
    mockEnvVars.mockReturnValue(new Set<string>()) // no keys at all
    const body = {
      fallback_providers: [{ provider: 'ollama', model: 'my-local-build:latest', base_url: 'http://host.docker.internal:11434/v1' }],
    }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  it('accepts an unknown / uncertain provider even with no key (fail open, 200)', async () => {
    mockEnvVars.mockReturnValue(new Set<string>())
    const body = { provider: 'nous', cascade: ['Hermes-4-405B'] }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  it('still rejects an empty cascade (400)', async () => {
    const body = { provider: 'anthropic', cascade: [] }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(400)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects an empty model id even when the provider has a key (400)', async () => {
    const body = { fallback_providers: [{ provider: 'anthropic', model: '' }] }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/missing model/i)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})
