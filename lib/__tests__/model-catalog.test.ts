// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { validateCascadeEntries } from '../model-catalog'

describe('validateCascadeEntries', () => {
  it('accepts a valid cascade of catalogued models', () => {
    const errors = validateCascadeEntries([
      { provider: 'anthropic', model: 'claude-sonnet-4-6' },
      { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    ])
    expect(errors).toEqual([])
  })

  it('rejects an unknown model id for a catalogued, strict provider', () => {
    const errors = validateCascadeEntries([
      { provider: 'anthropic', model: 'claude-does-not-exist-9000' },
    ])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('claude-does-not-exist-9000')
    expect(errors[0]).toContain('anthropic')
  })

  it('rejects an empty model id', () => {
    const errors = validateCascadeEntries([{ provider: 'anthropic', model: '' }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/missing model/i)
  })

  it('reports every offending entry, not just the first', () => {
    const errors = validateCascadeEntries([
      { provider: 'anthropic', model: 'claude-sonnet-4-6' }, // valid
      { provider: 'openai', model: 'gpt-nope' }, // invalid
      { provider: 'google', model: 'gemini-fake' }, // invalid
    ])
    expect(errors).toHaveLength(2)
    expect(errors.join(' ')).toContain('gpt-nope')
    expect(errors.join(' ')).toContain('gemini-fake')
  })

  // --- Provider leniency: mirror /suggest, which builds suggestions only for
  // catalogued providers but never restricts free-form ones. ---

  it('accepts free-form provider (ollama) model ids not in the catalog', () => {
    const errors = validateCascadeEntries([
      { provider: 'ollama', model: 'some-custom-local-build:latest' },
    ])
    expect(errors).toEqual([])
  })

  it('accepts free-form provider (openrouter) model ids not in the catalog', () => {
    const errors = validateCascadeEntries([
      { provider: 'openrouter', model: 'meta-llama/llama-4-maverick' },
    ])
    expect(errors).toEqual([])
  })

  it('accepts the custom (proxy) provider with arbitrary model ids', () => {
    const errors = validateCascadeEntries([
      { provider: 'custom', model: 'whatever-proxy-model' },
    ])
    expect(errors).toEqual([])
  })

  it('accepts a provider not present in the catalog (no authoritative list)', () => {
    const errors = validateCascadeEntries([
      { provider: 'nous', model: 'Hermes-4-405B' },
    ])
    expect(errors).toEqual([])
  })

  it('accepts an entry with no provider (legacy / unknown provider)', () => {
    const errors = validateCascadeEntries([{ provider: '', model: 'anything-goes' }])
    expect(errors).toEqual([])
  })

  it('still rejects an empty model id even for free-form providers', () => {
    const errors = validateCascadeEntries([{ provider: 'ollama', model: '' }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/missing model/i)
  })
})
