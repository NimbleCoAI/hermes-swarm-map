import { describe, it, expect } from 'vitest'
import { normalizeEmptyMentionGating } from '../harness'

describe('normalizeEmptyMentionGating', () => {
  it('rewrites an empty SIGNAL_REQUIRE_MENTION to the secure default true', () => {
    // An empty value reads as false at runtime but HSM's default is require-mention;
    // an imported/legacy .env with KEY= must not silently un-gate the agent.
    const out = normalizeEmptyMentionGating('FOO=bar\nSIGNAL_REQUIRE_MENTION=\nBAZ=1\n')
    expect(out).toContain('SIGNAL_REQUIRE_MENTION=true')
    expect(out).not.toMatch(/^SIGNAL_REQUIRE_MENTION=\s*$/m)
  })

  it('normalizes empties for all three platforms, including whitespace-only', () => {
    const out = normalizeEmptyMentionGating(
      'SIGNAL_REQUIRE_MENTION=\nTELEGRAM_REQUIRE_MENTION=   \nMATTERMOST_REQUIRE_MENTION=\n'
    )
    expect(out).toContain('SIGNAL_REQUIRE_MENTION=true')
    expect(out).toContain('TELEGRAM_REQUIRE_MENTION=true')
    expect(out).toContain('MATTERMOST_REQUIRE_MENTION=true')
  })

  it('heals an empty value on a CRLF (Windows) line ending', () => {
    const out = normalizeEmptyMentionGating('SIGNAL_REQUIRE_MENTION=\r\nFOO=bar\r\n')
    expect(out).toContain('SIGNAL_REQUIRE_MENTION=true')
    expect(out).not.toMatch(/^SIGNAL_REQUIRE_MENTION=\s*\r?$/m)
  })

  it('leaves an explicit true untouched', () => {
    const out = normalizeEmptyMentionGating('SIGNAL_REQUIRE_MENTION=true\n')
    expect(out).toBe('SIGNAL_REQUIRE_MENTION=true\n')
  })

  it('leaves an explicit false untouched — that is a deliberate respond-to-all choice', () => {
    const out = normalizeEmptyMentionGating('SIGNAL_REQUIRE_MENTION=false\n')
    expect(out).toBe('SIGNAL_REQUIRE_MENTION=false\n')
  })

  it('does not invent a line that was absent', () => {
    const out = normalizeEmptyMentionGating('GITHUB_TOKEN=x\n')
    expect(out).toBe('GITHUB_TOKEN=x\n')
  })
})
