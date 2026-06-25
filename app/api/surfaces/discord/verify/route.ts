import { NextResponse } from 'next/server'

/**
 * Validate a Discord bot token by calling the Discord API server-side.
 *
 * Server-side (not from the browser) so the token never touches client code
 * and we dodge Discord's CORS. Discord authenticates bots with the `Bot`
 * scheme — `GET /users/@me` returns the bot's own user object.
 */
export async function POST(request: Request) {
  const { token } = await request.json()
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })
  try {
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return NextResponse.json({ valid: false, error: `HTTP ${res.status}` })
    const user = await res.json()
    return NextResponse.json({ valid: true, username: user.username, id: user.id })
  } catch (err) {
    return NextResponse.json({ valid: false, error: String(err) })
  }
}
