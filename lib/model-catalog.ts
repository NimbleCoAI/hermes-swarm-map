// lib/model-catalog.ts

export type ModelEntry = {
  id: string
  name: string
  tier: 'primary' | 'fallback' | 'local'
}

export const MODEL_CATALOG: Record<string, ModelEntry[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'primary' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'fallback' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', tier: 'primary' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', tier: 'fallback' },
  ],
  google: [
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', tier: 'primary' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', tier: 'primary' },
  ],
  ollama: [
    { id: 'qwen3:30b', name: 'Qwen3 30B', tier: 'local' },
    { id: 'llama3.1:8b', name: 'Llama 3.1 8B', tier: 'local' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (OR)', tier: 'primary' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (OR)', tier: 'fallback' },
  ],
  bedrock: [
    { id: 'us.anthropic.claude-sonnet-4-6-20250527-v1:0', name: 'Claude Sonnet 4.6 (Bedrock)', tier: 'primary' },
  ],
}

// Providers whose model ids are intentionally open / free-form: the catalog
// cannot enumerate them, so model ids for these providers are NOT checked for
// catalog membership.
//
//  - ollama:     any locally-pulled model tag (e.g. `qwen3:30b`, custom builds)
//  - openrouter: hundreds of routed models, far beyond what the catalog lists
//  - custom:     proxy/self-hosted providers (base_url) with arbitrary model ids
//
// Any provider that is NOT a key in MODEL_CATALOG is also treated as free-form,
// since we have no authoritative list of its models to validate against.
export const FREEFORM_PROVIDERS = new Set(['ollama', 'openrouter', 'custom'])

export type CascadeEntry = { provider: string; model: string }

/**
 * Validate a list of (provider, model) cascade entries against MODEL_CATALOG.
 *
 * This is a guard against pushing a structurally-bad or unknown model id onto a
 * live agent (which can crash-loop it). It is deliberately lenient:
 *
 *  - Empty / missing model ids are always rejected (they break the agent config).
 *  - For free-form providers (see FREEFORM_PROVIDERS) and any provider not in the
 *    catalog, model ids are accepted as-is — the catalog is not authoritative for
 *    them.
 *  - For catalog-enumerated, non-free-form providers (anthropic, openai, google,
 *    bedrock) the model id must appear in MODEL_CATALOG for that provider.
 *
 * Returns a list of human-readable error strings (empty list = valid).
 */
export function validateCascadeEntries(entries: CascadeEntry[]): string[] {
  const errors: string[] = []

  for (const entry of entries) {
    const provider = (entry.provider ?? '').trim()
    const model = (entry.model ?? '').trim()

    if (!model) {
      errors.push(
        provider
          ? `Missing model id for provider "${provider}"`
          : 'Missing model id'
      )
      continue
    }

    // No provider supplied, or provider is free-form / not catalogued: accept
    // the model id as-is. We have no authoritative list to check it against.
    if (!provider || FREEFORM_PROVIDERS.has(provider) || !(provider in MODEL_CATALOG)) {
      continue
    }

    const known = MODEL_CATALOG[provider].some((m) => m.id === model)
    if (!known) {
      const valid = MODEL_CATALOG[provider].map((m) => m.id).join(', ')
      errors.push(
        `Unknown model "${model}" for provider "${provider}". Known models: ${valid}`
      )
    }
  }

  return errors
}

// Map env var patterns to provider names (same as keys.ts PROVIDER_PATTERNS)
export const ENV_TO_PROVIDER: Record<string, string> = {
  ANTHROPIC_API_KEY: 'anthropic',
  OPENAI_API_KEY: 'openai',
  GOOGLE_API_KEY: 'google',
  VERTEX_PROJECT_ID: 'google',
  OLLAMA_BASE_URL: 'ollama',
  OPENROUTER_API_KEY: 'openrouter',
  AWS_BEARER_TOKEN_BEDROCK: 'bedrock',
  AWS_ACCESS_KEY_ID: 'bedrock',
}
