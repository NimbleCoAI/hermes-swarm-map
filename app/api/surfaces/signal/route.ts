import { NextResponse } from 'next/server'
import { getSignalDaemonUrl } from '@/lib/env-helpers'

const SIGNAL_API = getSignalDaemonUrl()

export async function GET() {
  try {
    const healthRes = await fetch(`${SIGNAL_API}/api/v1/check`, {
      signal: AbortSignal.timeout(3000),
    })
    const healthy = healthRes.ok

    let accounts: string[] = []
    if (healthy) {
      const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
        signal: AbortSignal.timeout(3000),
      })
      const rpcData = await rpcRes.json()
      if (Array.isArray(rpcData.result)) {
        accounts = rpcData.result.map((a: { number?: string }) => a.number || '')
      }
    }

    return NextResponse.json({ healthy, url: SIGNAL_API, accounts })
  } catch {
    return NextResponse.json({ healthy: false, url: SIGNAL_API, accounts: [] })
  }
}
