/**
 * Tests for POST /api/surfaces/slack/verify
 *
 * Validates a Slack bot token via Slack's auth.test (server-side, `Bearer`).
 * Slack returns HTTP 200 with { ok: false } for bad tokens, so a 200 is not
 * enough — the route must check the `ok` field.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { POST } from './route'

function req(body: unknown) {
  return new Request('http://localhost/api/surfaces/slack/verify', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('slack verify route', () => {
  it('returns valid + identity for a good token', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, user: 'slackbot', team: 'Acme', user_id: 'U123' }),
    })) as unknown as typeof fetch

    const res = await POST(req({ token: 'xoxb-good' }))
    const data = await res.json()

    expect(data.valid).toBe(true)
    expect(data.username).toBe('slackbot')
    expect(data.team).toBe('Acme')
    expect(data.id).toBe('U123')

    // Must authenticate with the Bearer scheme.
    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const init = fetchFn.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer xoxb-good')
  })

  it('treats Slack ok:false (HTTP 200) as invalid', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: false, error: 'invalid_auth' }),
    })) as unknown as typeof fetch

    const res = await POST(req({ token: 'xoxb-bad' }))
    const data = await res.json()

    expect(data.valid).toBe(false)
    expect(data.error).toBe('invalid_auth')
  })

  it('400s when the token is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })
})
