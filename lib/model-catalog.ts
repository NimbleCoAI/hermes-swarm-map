// lib/model-catalog.ts

export type ModelEntry = {
  id: string
  name: string
  tier: 'primary' | 'fallback' | 'local'
}

export const MODEL_CATALOG: Record<string, ModelEntry[]> = {
  anthropic: [
    { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', tier: 'primary' },
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
    { id: 'anthropic/claude-sonnet-4-5', name: 'Claude Sonnet 4.5 (OR)', tier: 'primary' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (OR)', tier: 'fallback' },
  ],
  bedrock: [
    { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', name: 'Claude Sonnet 4.5 (Bedrock)', tier: 'primary' },
  ],
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
