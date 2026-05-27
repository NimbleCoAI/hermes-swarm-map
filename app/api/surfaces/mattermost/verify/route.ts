import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const { url, token } = await request.json()
  if (!url || !token) return NextResponse.json({ error: 'Missing url or token' }, { status: 400 })
  try {
    const res = await fetch(`${url}/api/v4/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return NextResponse.json({ valid: false, error: `HTTP ${res.status}` })
    const user = await res.json()
    return NextResponse.json({ valid: true, username: user.username, id: user.id })
  } catch (err) {
    return NextResponse.json({ valid: false, error: String(err) })
  }
}
