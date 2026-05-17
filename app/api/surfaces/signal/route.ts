import { NextResponse } from 'next/server'

const SIGNAL_CLI_URL = process.env.SIGNAL_CLI_URL || 'http://localhost:8080'

export async function GET() {
  try {
    // Check daemon health
    const healthRes = await fetch(`${SIGNAL_CLI_URL}/api/v1/check`, {
      signal: AbortSignal.timeout(3000),
    })
    const healthy = healthRes.ok

    // List registered accounts
    let accounts: string[] = []
    if (healthy) {
      const rpcRes = await fetch(`${SIGNAL_CLI_URL}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: 1 }),
        signal: AbortSignal.timeout(3000),
      })
      const rpcData = await rpcRes.json()
      accounts = rpcData.result || []
    }

    return NextResponse.json({
      healthy,
      url: SIGNAL_CLI_URL,
      accounts,
    })
  } catch {
    return NextResponse.json({ healthy: false, url: SIGNAL_CLI_URL, accounts: [] })
  }
}
