// @vitest-environment node
//
// Proves the newline-injection defenses at the four generated-file sinks
// (findings F8–F11 of the 2026-07 security review). A `\r` or `\n` in a value
// that is spliced into a `.env` file or a docker-compose YAML lets an attacker
// inject extra `KEY=value` lines (policy override) or extra YAML keys
// (`privileged: true` + `/:/host` → container breakout to host root). Every
// sink must refuse such values rather than write them.
import { describe, it, expect } from 'vitest'
import { assertNoNewline, mergeEnvVars } from '@/lib/env-helpers'
import { setComposeImage } from '../harness-compose'
import { upsertEnvVar } from '../keys'
import { generateEnvContent } from '../agent-deploy-templates'

describe('assertNoNewline', () => {
  it('rejects a value containing a line feed', () => {
    expect(() => assertNoNewline('good\nBAD=1', 'field')).toThrow(/field/)
  })
  it('rejects a value containing a carriage return', () => {
    expect(() => assertNoNewline('good\rBAD=1', 'field')).toThrow(/field/)
  })
  it('returns the value unchanged when clean', () => {
    expect(assertNoNewline('sk-ant-api-abc.def_123', 'field')).toBe('sk-ant-api-abc.def_123')
  })
})

describe('mergeEnvVars — F11 (shared env sink)', () => {
  it('refuses a value that injects an extra env line', () => {
    // Without the guard this would append `HERMES_DM_POLICY=allow-all`,
    // overriding the secure-default policy the operator set.
    expect(() =>
      mergeEnvVars('EXISTING=1\n', {
        TELEGRAM_BOT_TOKEN: 'tok\nHERMES_DM_POLICY=allow-all',
      }),
    ).toThrow(/newline/i)
  })
  it('still merges clean values', () => {
    expect(mergeEnvVars('A=1\n', { B: '2' })).toContain('B=2')
  })
})

describe('upsertEnvVar — F9 (keys → agent .env)', () => {
  it('refuses a secret value carrying a newline', () => {
    expect(() =>
      upsertEnvVar('X=1\n', 'ANTHROPIC_API_KEY', 'sk\nSIGNAL_REQUIRE_MENTION=false'),
    ).toThrow(/newline/i)
  })
  it('still writes a clean secret', () => {
    expect(upsertEnvVar('X=1\n', 'ANTHROPIC_API_KEY', 'sk-ant-123')).toContain(
      'ANTHROPIC_API_KEY=sk-ant-123',
    )
  })
})

describe('generateEnvContent — F10 (deploy template)', () => {
  const base = { name: 'unit', port: 8000, provider: 'anthropic', primaryModel: 'claude-opus-4-8' }
  it('refuses a deploy token that injects a policy override', () => {
    expect(() =>
      generateEnvContent({ ...base, githubToken: 'x\nHERMES_DM_POLICY=allow-all' }),
    ).toThrow(/newline/i)
  })
  it('still generates a clean env body', () => {
    expect(generateEnvContent({ ...base, githubToken: 'ghp_clean123' })).toContain('API_SERVER_PORT=8000')
  })
})

describe('setComposeImage — F8 (compose YAML → host-root breakout)', () => {
  const COMPOSE = ['services:', '  hermes-unit:', '    image: old:latest', '    restart: unless-stopped'].join('\n')
  it('refuses an image ref that injects privileged + host bind', () => {
    const evil = 'img:latest\n    privileged: true\n    volumes:\n      - /:/host'
    expect(() => setComposeImage(COMPOSE, evil)).toThrow(/newline/i)
  })
  it('still replaces a clean image ref', () => {
    expect(setComposeImage(COMPOSE, 'ghcr.io/x/y:1.2.3')).toContain('    image: ghcr.io/x/y:1.2.3')
  })
})
