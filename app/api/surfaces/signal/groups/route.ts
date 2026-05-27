import { NextResponse } from 'next/server'

const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const phone = searchParams.get('phone')

  if (!phone) {
    return NextResponse.json({ error: 'phone param required' }, { status: 400 })
  }

  try {
    const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'listGroups',
        id: '1',
        params: { account: phone },
      }),
      signal: AbortSignal.timeout(15000),
    })

    const rpcData = await rpcRes.json()

    if (rpcData.error) {
      return NextResponse.json({ error: rpcData.error.message || 'Failed to list groups', groups: [] }, { status: 500 })
    }

    const groups = Array.isArray(rpcData.result)
      ? rpcData.result.map((g: { id?: string; name?: string; isBlocked?: boolean; isMember?: boolean }) => ({
          id: g.id || '',
          name: g.name || 'Unknown',
          active: g.isMember !== false && !g.isBlocked,
        }))
      : []

    return NextResponse.json({ groups })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to list groups'
    return NextResponse.json({ error: msg, groups: [] }, { status: 500 })
  }
}
