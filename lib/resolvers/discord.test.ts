// @vitest-environment node
/**
 * Tests for resolveDiscordUsername / expandDiscordAllowlist.
 *
 * Discord parity gap this closes: the runtime resolves usernames itself at
 * on_ready, but the HSM policy plane (surface-admins bootstrap →
 * is_platform_admin) reads DISCORD_ALLOWED_USERS raw — a username-only entry
 * authorizes at the agent while staying invisible to the policy plane.
 * Expansion stores BOTH forms, mirroring expandSignalAllowlist.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'

import { resolveDiscordUsername, expandDiscordAllowlist } from './discord'

const ENV = 'DISCORD_BOT_TOKEN=bot-token-value\n'

function mockFetchSequence(
  guilds: unknown,
  membersByGuild: Record<string, unknown>,
) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith('/users/@me/guilds')) {
      return { ok: true, json: async () => guilds } as Response
    }
    const m = u.match(/\/guilds\/([^/]+)\/members\/search/)
    if (m) {
      const body = membersByGuild[m[1]]
      return { ok: body !== undefined, json: async () => body ?? [] } as Response
    }
    return { ok: false, json: async () => ({}) } as Response
  })
}

describe('resolveDiscordUsername', () => {
  beforeEach(() => {
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'readFileSync').mockReturnValue(ENV as never)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('resolves a username via guild member search (case-insensitive)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ user: { id: '424242', username: 'Vincent', global_name: 'Vince' } }] },
    ))
    const r = await resolveDiscordUsername('h_test', 'vincent')
    expect(r).toEqual({ display: 'vincent', nativeId: '424242', profileName: 'Vincent' })
  })

  it('matches on global_name and nick too', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ nick: 'vinny', user: { id: '424242', username: 'other-handle' } }] },
    ))
    const r = await resolveDiscordUsername('h_test', 'vinny')
    expect(r?.nativeId).toBe('424242')
  })

  it('returns null when no guild member matches exactly', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      // Search is prefix-based server-side; an inexact candidate must not match.
      { g1: [{ user: { id: '1', username: 'vincent-other' } }] },
    ))
    expect(await resolveDiscordUsername('h_test', 'vincent')).toBeNull()
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
  beforeEach(() => {
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'readFileSync').mockReturnValue(ENV as never)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('stores BOTH the username and its resolved snowflake', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ user: { id: '424242', username: 'vincent' } }] },
    ))
    expect(await expandDiscordAllowlist('h_test', ['1111', 'vincent']))
      .toEqual(['1111', 'vincent', '424242'])
  })

  it('passes snowflakes and the wildcard through without resolving', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await expandDiscordAllowlist('h_test', ['*', '123456789']))
      .toEqual(['*', '123456789'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps an unresolvable username unchanged (no worse than before)', async () => {
    vi.stubGlobal('fetch', mockFetchSequence([{ id: 'g1' }], { g1: [] }))
    expect(await expandDiscordAllowlist('h_test', ['ghostname']))
      .toEqual(['ghostname'])
  })

  it('dedupes when the snowflake is already listed', async () => {
    vi.stubGlobal('fetch', mockFetchSequence(
      [{ id: 'g1' }],
      { g1: [{ user: { id: '424242', username: 'vincent' } }] },
    ))
    expect(await expandDiscordAllowlist('h_test', ['424242', 'vincent']))
      .toEqual(['424242', 'vincent'])
  })
})
