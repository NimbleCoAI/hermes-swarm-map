// @vitest-environment node
/**
 * Tests for PUT /api/harnesses/:id/models.
 *
 * The PUT route writes the model cascade into the agent's config.yaml and the
 * agent restarts onto it. An unknown / empty model id can crash-loop a live
 * agent, so the route validates every (provider, model) pair against the model
 * catalog before touching config.yaml. Free-form providers (ollama / openrouter
 * / custom) and non-catalogued providers are accepted as-is.
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

vi.mock('@/lib/services/harness', () => ({
  guessDataDir: vi.fn(() => '/tmp/hermes-test-data'),
  readModelConfig: vi.fn(() => []),
  readModelProvider: vi.fn(() => ''),
  readFallbackProviders: vi.fn(() => []),
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
    // Pretend config.yaml exists and is writable; capture writes in-memory.
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      'model:\n  provider: anthropic\n  default: claude-sonnet-4-6\n' as never
    )
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('accepts a valid catalogued cascade and writes config.yaml (200)', async () => {
    const body = { provider: 'anthropic', cascade: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'] }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(fs.writeFileSync).toHaveBeenCalled()
    expect(services.harness.updateConfig).toHaveBeenCalled()
  })

  it('rejects an unknown model id for a strict provider (400) without writing', async () => {
    const body = { provider: 'anthropic', cascade: ['claude-does-not-exist-9000'] }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('claude-does-not-exist-9000')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
  })

  it('rejects an unknown model in the fallback_providers shape (400)', async () => {
    const body = {
      fallback_providers: [
        { provider: 'anthropic', model: 'claude-sonnet-4-6' }, // valid
        { provider: 'openai', model: 'gpt-totally-made-up' }, // invalid
      ],
    }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain('gpt-totally-made-up')
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('accepts a free-form provider (ollama) with an uncatalogued model (200)', async () => {
    const body = {
      fallback_providers: [{ provider: 'ollama', model: 'my-local-build:latest', base_url: 'http://host.docker.internal:11434/v1' }],
    }
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
})
