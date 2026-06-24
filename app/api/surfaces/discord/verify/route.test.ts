/**
 * Tests for POST /api/surfaces/discord/verify
 *
 * Validates a Discord bot token by calling the Discord API server-side
 * (keeps the token off the browser and dodges Discord's CORS). Returns
 * { valid, username, id } on success.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { POST } from './route'

function req(body: unknown) {
  return new Request('http://localhost/api/surfaces/discord/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('discord verify route', () => {
  it('returns valid + username for a good token', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: '12345', username: 'discordbot' }),
    })) as unknown as typeof fetch

    const res = await POST(req({ token: 'good-token' }))
    const data = await res.json()

    expect(data.valid).toBe(true)
    expect(data.username).toBe('discordbot')
    expect(data.id).toBe('12345')

    // Must authenticate with the Bot scheme, not Bearer.
    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const init = fetchFn.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bot good-token')
  })

  it('returns invalid for a rejected token', async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch

    const res = await POST(req({ token: 'bad-token' }))
    const data = await res.json()

    expect(data.valid).toBe(false)
    expect(data.error).toContain('401')
  })

  it('400s when the token is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })
})
