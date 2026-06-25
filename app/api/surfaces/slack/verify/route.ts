import { NextResponse } from 'next/server'

/**
 * Validate a Slack bot token by calling Slack's auth.test server-side.
 *
 * Server-side (not from the browser) so the token never touches client code.
 * auth.test authenticates the bot OAuth token (xoxb-) and echoes the bot's
 * identity. The app-level token (xapp-) authenticates the Socket Mode
 * websocket, not a REST call, so it's format-checked client-side and only
 * truly exercised when the gateway opens the socket.
 */
export async function POST(request: Request) {
  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  try {
    const res = await fetch('https://slack.com/api/auth.test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return NextResponse.json({ valid: false, error: `HTTP ${res.status}` })
    const data = await res.json()
    // Slack returns 200 with { ok: false, error } for bad tokens.
    if (!data.ok) return NextResponse.json({ valid: false, error: data.error || 'invalid token' })
    return NextResponse.json({ valid: true, username: data.user, team: data.team, id: data.user_id })
  } catch (err) {
    return NextResponse.json({ valid: false, error: String(err) })
  }
}
