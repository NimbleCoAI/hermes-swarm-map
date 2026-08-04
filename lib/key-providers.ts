// Single source of truth for the "add an API key" provider dropdown.
//
// This list used to be duplicated: one copy in app/(dashboard)/keys/page.tsx and
// a second, unrelated copy in app/(dashboard)/harnesses/[id]/page.tsx. They drifted
// in BOTH directions — the harness-scoped menu was missing `google` and `custom`,
// the global menu was missing the twelve service providers below `brave`. Anything
// added to only one menu is invisible from the other, so keep this the only copy.
//
// Not to be confused with MODEL_PROVIDERS in harnesses/[id]/page.tsx — that drives
// the model cascade editor (inference backends), not credential storage.
//
// Ordering is presentational: model/inference first, then platform/surface, then
// service APIs, with `custom` last as the escape hatch.
//
// `custom` is special on the write path: KeysService.resolveEnvVar has no
// PROVIDER_TO_VAR entry for it, so it resolves via the explicit `envVar` hint,
// else the key's name, else the useless CUSTOM_API_KEY fallback. Any form that
// offers `custom` must therefore also offer the env-var field.
//
// `bluesky` is a credential PAIR: the app password is the secret (→
// BLUESKY_APP_PASSWORD) and the account handle is non-secret config (→
// BLUESKY_IDENTIFIER, from the key's `identifier` field). Any form that offers
// `bluesky` must therefore also offer the identifier field.
export const KEY_PROVIDERS = [
  // Model / inference. `openrouter` maps to OPENROUTER_API_KEY on the write path
  // (see KeysService.resolveEnvVar) — the fleet's GLM-5.2 chat primary AND its
  // cheap-metered rung ([intelligent-routing-cost]) both ride OpenRouter, so
  // neither can be provisioned without it here.
  'anthropic', 'openai', 'google', 'google-cloud', 'openrouter', 'zai',
  'aws', 'aws-bedrock',
  // Platforms / surfaces
  'github', 'notion', 'telegram', 'signal', 'mattermost', 'bluesky',
  // Service APIs
  'brave', 'helius', 'coingecko', 'dehashed', 'opencorporates',
  'capsolver', 'open-measures', 'pexels',
  // Escape hatch — requires the env-var field, see above.
  'custom',
]

// A provider may reach a form from outside the list (a ?request= prefill via
// lib/keys-request, or a key discovered from an existing .env). Appending it
// keeps the select from silently dropping the caller's choice.
export function providerOptions(current: string): string[] {
  return current && !KEY_PROVIDERS.includes(current)
    ? [...KEY_PROVIDERS, current]
    : KEY_PROVIDERS
}
