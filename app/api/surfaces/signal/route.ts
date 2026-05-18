import { NextResponse } from 'next/server'

const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function GET() {
  try {
    // Check daemon health via bbernhard REST API
    const aboutRes = await fetch(`${SIGNAL_API}/v1/about`, {
      signal: AbortSignal.timeout(3000),
    })
    const healthy = aboutRes.ok

    // List registered accounts
    let accounts: string[] = []
    if (healthy) {
      const accountsRes = await fetch(`${SIGNAL_API}/v1/accounts`, {
        signal: AbortSignal.timeout(3000),
      })
      if (accountsRes.ok) {
        const data = await accountsRes.json()
        // bbernhard returns array of account objects or phone strings
        accounts = Array.isArray(data)
          ? data.map((a: string | { number?: string }) => typeof a === 'string' ? a : a.number || '')
          : []
      }
    }

    return NextResponse.json({
      healthy,
      url: SIGNAL_API,
      accounts,
    })
  } catch {
    return NextResponse.json({ healthy: false, url: SIGNAL_API, accounts: [] })
  }
}
