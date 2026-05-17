import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url')
  const token = searchParams.get('token')

  if (!url || !token) {
    return NextResponse.json({ error: 'url and token params required' }, { status: 400 })
  }

  try {
    // Get bot's user ID first
    const meRes = await fetch(`${url}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!meRes.ok) {
      return NextResponse.json({ error: 'Invalid token or unreachable server' }, { status: 401 })
    }
    const me = await meRes.json()

    // Get channels the bot is in
    const channelsRes = await fetch(`${url}/api/v4/users/${me.id}/channels`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!channelsRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
    }
    const channels = await channelsRes.json()

    // Filter to public/private channels (exclude DMs)
    const filtered = channels
      .filter((ch: { type: string }) => ch.type === 'O' || ch.type === 'P')
      .map((ch: { id: string; display_name: string; name: string; type: string }) => ({
        id: ch.id,
        name: ch.display_name || ch.name,
        type: ch.type === 'O' ? 'public' : 'private',
      }))

    return NextResponse.json({ channels: filtered })
  } catch {
    return NextResponse.json({ error: 'Network error', channels: [] }, { status: 500 })
  }
}
