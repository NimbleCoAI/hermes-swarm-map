import { NextResponse } from 'next/server'

const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')

  if (!phone) {
    return NextResponse.json({ error: 'phone param required' }, { status: 400 })
  }

  try {
    const res = await fetch(`${SIGNAL_API}/v1/groups/${encodeURIComponent(phone)}`, {
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: text || 'Failed to list groups', groups: [] }, { status: res.status })
    }

    const data = await res.json()
    // bbernhard returns array of group objects with id, name, etc.
    const groups = Array.isArray(data)
      ? data.map((g: { id?: string; internal_id?: string; name?: string; blocked?: boolean }) => ({
          id: g.id || g.internal_id || '',
          name: g.name || 'Unknown',
          active: !g.blocked,
        }))
      : []

    return NextResponse.json({ groups })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to list groups'
    return NextResponse.json({ error: msg, groups: [] }, { status: 500 })
  }
}
