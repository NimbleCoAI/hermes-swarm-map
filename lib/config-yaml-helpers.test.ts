/**
 * Tests for setPlatformEnabled — surgical config.yaml edits.
 *
 * The gateway only starts a platform with `platforms.<p>.enabled: true`
 * (gateway/run.py), so connect must flip this flag without destroying the
 * hand-maintained, comment-heavy config.yaml. These tests pin down every
 * edit case, including the trap of MULTIPLE `platforms:`-like keys (an
 * indented nested one + `platform_toolsets:`) — only the column-0 key is
 * the real gateway config.
 */

import { describe, it, expect } from 'vitest'
import { SURFACE_PLATFORMS, setPlatformEnabled } from './config-yaml-helpers'

const CONFIG_WITH_BLOCK = `# Hermes Agent config
model:
  provider: anthropic
  default: claude-sonnet-4-5

# --- Platform toolsets (explicit defaults) ---
platform_toolsets:
  cli: [hermes-cli]
  discord: [hermes-discord]

platforms:
  telegram:
    enabled: true
    allowed_users: []
  discord:
    enabled: false
    intents: default

display:
  compact: false
`

const CONFIG_NO_BLOCK = `# Hermes Agent config
model:
  provider: anthropic
  default: claude-sonnet-4-5

display:
  compact: false
`

describe('setPlatformEnabled', () => {
  it('flips enabled: false to true, preserving sibling keys and comments', () => {
    const result = setPlatformEnabled(CONFIG_WITH_BLOCK, 'discord', true)
    expect(result).toMatch(/discord:\n    enabled: true\n    intents: default/)
    // Untouched entries and structure survive verbatim
    expect(result).toContain('  telegram:\n    enabled: true\n    allowed_users: []')
    expect(result).toContain('# Hermes Agent config')
    expect(result).toContain('# --- Platform toolsets (explicit defaults) ---')
    expect(result).toContain('display:\n  compact: false')
  })

  it('is a no-op when the platform is already enabled', () => {
    const result = setPlatformEnabled(CONFIG_WITH_BLOCK, 'telegram', true)
    expect(result).toBe(CONFIG_WITH_BLOCK)
  })

  it('inserts a missing platform entry under an existing platforms: block', () => {
    const result = setPlatformEnabled(CONFIG_WITH_BLOCK, 'slack', true)
    expect(result).toMatch(/platforms:\n(.|\n)*  slack:\n    enabled: true/)
    // Inserted INSIDE the block — before the next top-level key
    const blockMatch = result.match(/^platforms:\n([\s\S]*?)^\S/m)
    expect(blockMatch![1]).toContain('  slack:\n    enabled: true')
    // Existing entries survive
    expect(result).toContain('  discord:\n    enabled: false')
  })

  it('appends a new platforms: block at end of file when none exists', () => {
    const result = setPlatformEnabled(CONFIG_NO_BLOCK, 'discord', true)
    expect(result).toContain('platforms:\n  discord:\n    enabled: true')
    // Appended after existing content, original preserved
    expect(result.indexOf('display:')).toBeLessThan(result.indexOf('platforms:'))
    expect(result).toContain('display:\n  compact: false')
  })

  it('disables an enabled platform without deleting its other keys', () => {
    const result = setPlatformEnabled(CONFIG_WITH_BLOCK, 'telegram', false)
    expect(result).toContain('  telegram:\n    enabled: false\n    allowed_users: []')
    // Other platform untouched
    expect(result).toContain('  discord:\n    enabled: false\n    intents: default')
  })

  it('disable is a no-op when there is no platforms: block', () => {
    expect(setPlatformEnabled(CONFIG_NO_BLOCK, 'discord', false)).toBe(CONFIG_NO_BLOCK)
  })

  it('disable is a no-op when the platform entry is missing', () => {
    expect(setPlatformEnabled(CONFIG_WITH_BLOCK, 'slack', false)).toBe(CONFIG_WITH_BLOCK)
  })

  it('inserts enabled: true when the entry exists without an enabled line', () => {
    const config = `platforms:\n  discord:\n    intents: default\n`
    const result = setPlatformEnabled(config, 'discord', true)
    expect(result).toContain('  discord:\n    enabled: true\n    intents: default')
  })

  it('preserves a trailing comment on the enabled line', () => {
    const config = `platforms:\n  discord:\n    enabled: false  # flipped off manually\n`
    const result = setPlatformEnabled(config, 'discord', true)
    expect(result).toContain('enabled: true  # flipped off manually')
  })

  it('anchors to the TOP-LEVEL platforms: key, not an indented nested one', () => {
    // Production configs can contain an indented `  platforms:` under another
    // section — that one must never be edited.
    const config = `some_section:
  platforms:
    discord:
      enabled: false

platforms:
  telegram:
    enabled: true
`
    const result = setPlatformEnabled(config, 'discord', true)
    // Nested block untouched
    expect(result).toContain('some_section:\n  platforms:\n    discord:\n      enabled: false')
    // Entry added to the real top-level block
    expect(result).toMatch(/^platforms:\n  telegram:\n    enabled: true\n  discord:\n    enabled: true/m)
  })

  it('does not mistake platform_toolsets: for the platforms: block', () => {
    const config = `platform_toolsets:
  discord: [hermes-discord]
  telegram: [hermes-telegram]
`
    const result = setPlatformEnabled(config, 'discord', true)
    // Toolsets untouched; a fresh block appended
    expect(result).toContain('platform_toolsets:\n  discord: [hermes-discord]')
    expect(result).toContain('platforms:\n  discord:\n    enabled: true')
  })

  it('ignores a deeper-nested key matching the platform name inside the block', () => {
    // `discord:` under telegram's sub-map must not be treated as the entry.
    const config = `platforms:
  telegram:
    enabled: true
    routing:
      discord: something
`
    const result = setPlatformEnabled(config, 'discord', true)
    expect(result).toContain('      discord: something')
    expect(result).toMatch(/  discord:\n    enabled: true/)
  })

  it('rejects unknown platform slugs (never spliced into the file)', () => {
    expect(() => setPlatformEnabled(CONFIG_WITH_BLOCK, 'evil\nplatform', true)).toThrow(/Unknown platform/)
    expect(() => setPlatformEnabled(CONFIG_WITH_BLOCK, 'irc', true)).toThrow(/Unknown platform/)
    expect(() => setPlatformEnabled(CONFIG_WITH_BLOCK, 'discord:\n  privileged', false)).toThrow(/Unknown platform/)
  })

  it('handles a block that ends at end-of-file', () => {
    const config = `model:\n  provider: anthropic\n\nplatforms:\n  discord:\n    enabled: false`
    const result = setPlatformEnabled(config, 'discord', true)
    expect(result).toContain('  discord:\n    enabled: true')
  })
})

describe('setPlatformEnabled — audit regression cases', () => {
  it('col-0 comment between entries does not hide the entry after it', () => {
    const input = [
      'platforms:',
      '  discord:',
      '    enabled: true',
      '# --- messaging ---',
      '  telegram:',
      '    enabled: false',
      'other:',
    ].join('\n')
    const out = setPlatformEnabled(input, 'telegram', true)
    // The real entry is flipped in place — no duplicate key inserted.
    expect(out).toContain('  telegram:\n    enabled: true')
    expect(out.match(/^ {2}telegram:/gm)).toHaveLength(1)
  })

  it('CRLF file: flips in place and preserves CRLF endings', () => {
    const input = 'platforms:\r\n  discord:\r\n    enabled: true\r\nother:\r\n'
    const out = setPlatformEnabled(input, 'discord', false)
    expect(out).toBe('platforms:\r\n  discord:\r\n    enabled: false\r\nother:\r\n')
  })

  it('CRLF file: disable is not a silent no-op', () => {
    const input = 'platforms:\r\n  discord:\r\n    enabled: true\r\n'
    const out = setPlatformEnabled(input, 'discord', false)
    expect(out).not.toBe(input)
    expect(out).toContain('enabled: false')
  })

  it('nested key named enabled does not shadow the direct gateway flag', () => {
    const input = [
      'platforms:',
      '  discord:',
      '    voice:',
      '      enabled: true',
      '    enabled: false',
      'other:',
    ].join('\n')
    const out = setPlatformEnabled(input, 'discord', true)
    const lines = out.split('\n')
    // Nested voice.enabled untouched; direct flag flipped.
    expect(lines).toContain('      enabled: true')
    expect(lines).toContain('    enabled: true')
    expect(lines).not.toContain('    enabled: false')
  })

  it('nested enabled first + no direct flag: inserts at direct-child depth', () => {
    const input = [
      'platforms:',
      '  discord:',
      '    voice:',
      '      enabled: true',
      'other:',
    ].join('\n')
    const out = setPlatformEnabled(input, 'discord', false)
    // Inserted as a direct child (4 spaces), not deeper.
    expect(out.split('\n')[2]).toBe('    enabled: false')
  })
})

describe('platform allowlist lockstep', () => {
  it('SURFACE_PLATFORMS matches env-helpers POLICY_VARS platforms', async () => {
    const { POLICY_VARS } = await import('./env-helpers')
    expect([...SURFACE_PLATFORMS].sort()).toEqual(Object.keys(POLICY_VARS).sort())
  })
})
