// @vitest-environment node
/**
 * Tests for resolveDiscordUsername / expandDiscordAllowlist.
 *
 * Discord parity gap this closes: the runtime resolves usernames itself at
 * on_ready, but the HSM policy plane (surface-admins bootstrap →
 * is_platform_admin) reads DISCORD_ALLOWED_USERS raw — a username-only entry
 * authorizes at the agent while staying invisible to the policy plane.
 * Expansion stores BOTH forms, mirroring expandSignalAllowlist.
 *
 * Matching is authorization-grade: username only (globally unique), never
 * global_name/nick (freely self-settable → name-squatting an operator's entry
 * would persist an attacker's snowflake into an authorization store), and a
 * name matching DIFFERENT snowflakes across guilds refuses to resolve.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'

import {
  resolveDiscordUsername,
  expandDiscordAllowlist,
  _clearDiscordResolverMemo,
} from './discord'

const ENV = 'DISCORD_BOT_TOKEN=bot-token-value\n'

function mockFetchSequence(
  guilds: unknown,
  membersByGuild: Record<string, unknown>,
  opts: { status429?: Set<string> } = {},
) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith('/users/@me/guilds')) {
      return { ok: true, status: 200, json: async () => guilds } as Response
    }
    const m = u.match(/\/guilds\/([^/]+)\/members\/search/)
    if (m) {
      if (opts.status429?.has(m[1])) {
        return { ok: false, status: 429, json: async () => ({}) } as Response
      }
      const body = membersByGuild[m[1]]
      return { ok: body !== undefined, status: body !== undefined ? 200 : 404, json: async () => body ?? [] } as Response
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response
  })
}

beforeEach(() => {
  _clearDiscordResolverMemo()
  vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
  vi.spyOn(fs, 'readFileSync').mockReturnValue(ENV as never)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('resolveDiscordUsername', () => {
  it('resolves a username via guild member search (case-insensitive)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ user: { id: '424242', username: 'Vincent' } }] },
    ))
    const r = await resolveDiscordUsername('h_test', 'vincent')
    expect(r).toEqual({ display: 'vincent', nativeId: '424242', profileName: 'Vincent' })
  })

  it('scans past the first guild to find the match', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }, { id: 'g2' }],
      { g1: [], g2: [{ user: { id: '424242', username: 'vincent' } }] },
    ))
    expect((await resolveDiscordUsername('h_test', 'vincent'))?.nativeId).toBe('424242')
  })

  it('NEVER matches global_name or nick — they are attacker-settable', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ nick: 'vincent', user: { id: '666', username: 'squatter', global_name: 'vincent' } }] },
    ))
    expect(await resolveDiscordUsername('h_test', 'vincent')).toBeNull()
  })

  it('refuses when the same name matches different snowflakes across guilds', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }, { id: 'g2' }],
      {
        g1: [{ user: { id: '111111', username: 'vincent' } }],
        g2: [{ user: { id: '222222', username: 'vincent' } }],
      },
    ))
    expect(await resolveDiscordUsername('h_test', 'vincent')).toBeNull()
  })

  it('same snowflake in several guilds still resolves', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }, { id: 'g2' }],
      {
        g1: [{ user: { id: '424242', username: 'vincent' } }],
        g2: [{ user: { id: '424242', username: 'vincent' } }],
      },
    ))
    expect((await resolveDiscordUsername('h_test', 'vincent'))?.nativeId).toBe('424242')
  })

  it('aborts the whole scan on 429 instead of skipping the guild', async () => {
    // Continuing past a rate-limited guild could skip the true match and let
    // a later guild win — the squatting scenario again, via rate limits.
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }, { id: 'g2' }],
      { g2: [{ user: { id: '666', username: 'vincent' } }] },
      { status429: new Set(['g1']) },
    ))
    expect(await resolveDiscordUsername('h_test', 'vincent')).toBeNull()
  })

  it('memoizes within the TTL (settings PUT resolves each name twice)', async () => {
    const fetchMock = mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ user: { id: '424242', username: 'vincent' } }] },
    )
    vi.stubGlobal('fetch', fetchMock)
    await resolveDiscordUsername('h_test', 'vincent')
    const callsAfterFirst = fetchMock.mock.calls.length
    await resolveDiscordUsername('h_test', 'vincent')
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
  })

  it('returns null without a bot token (no fetch attempted)', async () => {
    vi.mocked(fs.readFileSync).mockReturnValue('OTHER=1\n' as never)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await resolveDiscordUsername('h_test', 'vincent')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('survives API failure (returns null, never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await resolveDiscordUsername('h_test', 'vincent')).toBeNull()
  })
})

describe('expandDiscordAllowlist', () => {
  it('stores BOTH the username and its resolved snowflake', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ user: { id: '99887766554433221', username: 'vincent' } }] },
    ))
    expect(await expandDiscordAllowlist('h_test', ['12345678901234567', 'vincent']))
      .toEqual(['12345678901234567', 'vincent', '99887766554433221'])
  })

  it('passes snowflakes and the wildcard through without resolving', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await expandDiscordAllowlist('h_test', ['*', '12345678901234567']))
      .toEqual(['*', '12345678901234567'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a numeric outside the canonical 15–21 bound as a username, not a snowflake', async () => {
    // The skip check sources registry.identity.nativePattern (drift D8,
    // unified): '12345' is not a native id, so it goes through resolution —
    // observable as a guild scan — and stays raw when nothing matches.
    const fetchMock = mockFetchSequence([{ id: 'g1' }], { g1: [] })
    vi.stubGlobal('fetch', fetchMock)
    expect(await expandDiscordAllowlist('h_test', ['12345'])).toEqual(['12345'])
    expect(fetchMock).toHaveBeenCalled()
  })

  it('keeps an unresolvable username unchanged (no worse than before)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ id: 'g1' }], { g1: [] }))
    expect(await expandDiscordAllowlist('h_test', ['ghostname']))
      .toEqual(['ghostname'])
  })

  it('dedupes when the snowflake is already listed', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ user: { id: '99887766554433221', username: 'vincent' } }] },
    ))
    expect(await expandDiscordAllowlist('h_test', ['99887766554433221', 'vincent']))
      .toEqual(['99887766554433221', 'vincent'])
  })
})
