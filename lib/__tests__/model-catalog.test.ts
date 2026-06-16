// @vitest-environment node
//
// validateCascadeEntries guards the PUT /harnesses/:id/models write path. It
// rejects a cascade entry ONLY when it can POSITIVELY determine the entry is
// bad: an empty model id, or a provider that is DEFINITIVELY un-serviceable for
// this agent (needs a key, we know which env var, and it's absent). Everything
// uncertain FAILS OPEN — a valid config must never be blocked.
import { describe, it, expect } from 'vitest'
import { validateCascadeEntries } from '../model-catalog'

describe('validateCascadeEntries', () => {
  // --- Empty-id guard (always rejects, regardless of credentials) ----------

  it('rejects an empty model id', () => {
    const errors = validateCascadeEntries([{ provider: 'anthropic', model: '' }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/missing model/i)
  })

  it('still rejects an empty model id for a no-key provider', () => {
    const errors = validateCascadeEntries([{ provider: 'ollama', model: '' }])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/missing model/i)
  })

  // --- Provider WITH a configured key → passes -----------------------------

  it('accepts a model whose provider has a configured key', () => {
    const env = new Set(['ANTHROPIC_API_KEY'])
    const errors = validateCascadeEntries(
      [{ provider: 'anthropic', model: 'claude-opus-4-8' }], // NOT in catalog — must still pass
      env
    )
    expect(errors).toEqual([])
  })

  it('accepts anthropic when the key lives in ANTHROPIC_TOKEN (bearer format)', () => {
    const env = new Set(['ANTHROPIC_TOKEN'])
    const errors = validateCascadeEntries([{ provider: 'anthropic', model: 'claude-opus-4-8' }], env)
    expect(errors).toEqual([])
  })

  it('fails open when no env vars were read at all (missing/unreadable .env)', () => {
    // Empty set = we couldn't read the agent's .env. Must NOT reject an
    // enforced-provider model on credential grounds — only the empty-id guard applies.
    const errors = validateCascadeEntries(
      [{ provider: 'anthropic', model: 'claude-opus-4-8' }],
      new Set()
    )
    expect(errors).toEqual([])
  })

  it('still rejects an empty model id even when env is empty (floor guard holds)', () => {
    const errors = validateCascadeEntries([{ provider: 'anthropic', model: '' }], new Set())
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/missing model/i)
  })

  it('accepts a multi-entry cascade when every provider has its key', () => {
    const env = new Set(['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'])
    const errors = validateCascadeEntries(
      [
        { provider: 'anthropic', model: 'claude-opus-4-8' },
        { provider: 'openrouter', model: 'moonshotai/kimi-k2.7-code' },
      ],
      env
    )
    expect(errors).toEqual([])
  })

  // --- Provider that NEEDS a key but the agent has NONE → 400 --------------

  it('rejects a model whose provider needs a key the agent lacks (the crash case)', () => {
    const env = new Set(['ANTHROPIC_API_KEY']) // no OPENROUTER_API_KEY
    const errors = validateCascadeEntries(
      [{ provider: 'openrouter', model: 'moonshotai/kimi-k2.7-code' }],
      env
    )
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('moonshotai/kimi-k2.7-code')
    expect(errors[0]).toContain('openrouter')
    expect(errors[0]).toContain('OPENROUTER_API_KEY')
  })

  it('reports every un-serviceable entry, not just the first', () => {
    // Non-empty env (so the credential check is active) that simply lacks the
    // openrouter + openai keys — both entries are definitively un-serviceable.
    const env = new Set(['ANTHROPIC_API_KEY'])
    const errors = validateCascadeEntries(
      [
        { provider: 'openrouter', model: 'or-model' },
        { provider: 'openai', model: 'gpt-x' },
      ],
      env
    )
    expect(errors).toHaveLength(2)
    expect(errors.join(' ')).toContain('or-model')
    expect(errors.join(' ')).toContain('gpt-x')
  })

  // --- No-key providers → always pass --------------------------------------

  it('accepts ollama with no key configured (local, base_url)', () => {
    const errors = validateCascadeEntries(
      [{ provider: 'ollama', model: 'my-local-build:latest' }],
      new Set()
    )
    expect(errors).toEqual([])
  })

  it('accepts custom (proxy) with no key configured', () => {
    const errors = validateCascadeEntries(
      [{ provider: 'custom', model: 'whatever-proxy-model' }],
      new Set()
    )
    expect(errors).toEqual([])
  })

  // --- Fail-open on uncertainty --------------------------------------------

  it('accepts an unknown / uncertain provider even with no key (fail open)', () => {
    const errors = validateCascadeEntries([{ provider: 'nous', model: 'Hermes-4-405B' }], new Set())
    expect(errors).toEqual([])
  })

  it('accepts google/gemini with no single key (ambiguous auth → fail open)', () => {
    // Google has multiple auth modes (API key, Vertex/ADC, service account), so
    // a missing GOOGLE_API_KEY is NOT proof it's un-serviceable.
    expect(validateCascadeEntries([{ provider: 'google', model: 'gemini-3-pro' }], new Set())).toEqual([])
    expect(validateCascadeEntries([{ provider: 'gemini', model: 'gemini-3-pro' }], new Set())).toEqual([])
  })

  it('accepts bedrock even with no AWS creds in the .env (creds may be an instance role → fail open)', () => {
    const errors = validateCascadeEntries(
      [{ provider: 'bedrock', model: 'us.anthropic.claude-sonnet-4-6-20250527-v1:0' }],
      new Set()
    )
    expect(errors).toEqual([])
  })

  it('accepts an entry with no provider (legacy / unknown → fail open)', () => {
    const errors = validateCascadeEntries([{ provider: '', model: 'anything-goes' }], new Set())
    expect(errors).toEqual([])
  })

  it('fails open entirely when no env-var set is supplied (only the empty-id guard applies)', () => {
    // Default presentEnvVars = empty set, but callers that pass nothing get
    // credential validation effectively disabled (everything fails open) EXCEPT
    // providers we can prove need a key — which, with an empty set, would reject.
    // Verify a no-key provider and an uncertain provider still pass.
    expect(validateCascadeEntries([{ provider: 'ollama', model: 'x' }])).toEqual([])
    expect(validateCascadeEntries([{ provider: 'nous', model: 'x' }])).toEqual([])
  })
})
