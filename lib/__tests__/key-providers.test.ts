import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KEY_PROVIDERS, providerOptions } from '@/lib/key-providers'

const repoRoot = join(__dirname, '..', '..')
const read = (p: string) => readFileSync(join(repoRoot, p), 'utf8')

const KEYS_PAGE = 'app/(dashboard)/keys/page.tsx'
const HARNESS_PAGE = 'app/(dashboard)/harnesses/[id]/page.tsx'

describe('KEY_PROVIDERS', () => {
  it('has no duplicates', () => {
    expect(new Set(KEY_PROVIDERS).size).toBe(KEY_PROVIDERS.length)
  })

  it('offers custom — the escape hatch both add-key menus must expose', () => {
    expect(KEY_PROVIDERS).toContain('custom')
  })

  it('retains every provider each menu had before they were unified', () => {
    // Regression guard for the drift this module fixed: the harness-scoped menu
    // and the global keys menu each carried providers the other lacked.
    const onceGlobalOnly = ['google', 'custom']
    const onceHarnessOnly = [
      'zai', 'signal', 'mattermost', 'aws-bedrock', 'google-cloud', 'helius',
      'coingecko', 'dehashed', 'opencorporates', 'capsolver', 'open-measures', 'pexels',
    ]
    for (const p of [...onceGlobalOnly, ...onceHarnessOnly]) {
      expect(KEY_PROVIDERS, `${p} went missing`).toContain(p)
    }
  })
})

describe('providerOptions', () => {
  it('returns the canonical list for a known or empty provider', () => {
    expect(providerOptions('')).toEqual(KEY_PROVIDERS)
    expect(providerOptions('anthropic')).toEqual(KEY_PROVIDERS)
  })

  it('appends an unknown provider so a prefill is never silently dropped', () => {
    const opts = providerOptions('hedra')
    expect(opts).toContain('hedra')
    expect(opts).toHaveLength(KEY_PROVIDERS.length + 1)
  })
})

describe('both add-key menus stay in parity', () => {
  // The whole point of lib/key-providers: a locally-redeclared list is how the
  // two menus diverged in the first place. Fail loudly if one reappears.
  it.each([KEYS_PAGE, HARNESS_PAGE])('%s declares no local provider list', (page) => {
    expect(read(page)).not.toMatch(/const\s+KEY_PROVIDERS\s*=/)
  })

  it.each([KEYS_PAGE, HARNESS_PAGE])('%s sources its options from the shared module', (page) => {
    const src = read(page)
    expect(src).toContain("from '@/lib/key-providers'")
    expect(src).toMatch(/providerOptions\(/)
  })

  it.each([KEYS_PAGE, HARNESS_PAGE])('%s renders the env-var field custom keys need', (page) => {
    // Without it a custom key falls back to the name-derived var, or the
    // useless CUSTOM_API_KEY — see KeysService.resolveEnvVar.
    const src = read(page)
    expect(src).toMatch(/===\s*'custom'\s*&&/)
    expect(src).toMatch(/envVar/)
  })
})
