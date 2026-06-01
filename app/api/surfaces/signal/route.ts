import { NextResponse } from 'next/server'
import { getSignalDaemonUrl } from '@/lib/env-helpers'
import { services } from '@/lib/services'

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

    // Cross-reference PIN status for each known account
    const pinStatus: Record<string, string> = {}
    const harnesses = services.harness.list()
    const harnessAccounts: Array<{ phone: string; harnessId: string }> = []

    for (const h of harnesses) {
      if (h.platform === 'signal' && h.channel) {
        harnessAccounts.push({ phone: h.channel, harnessId: h.id })
      }
    }

    if (healthy && harnessAccounts.length > 0) {
      const status = await services.signalPin.checkPinHealth(accounts, harnessAccounts)
      Object.assign(pinStatus, status)
    } else {
      // Daemon not healthy — just report stored status
      for (const { phone } of harnessAccounts) {
        pinStatus[phone] = services.signalPin.getPinStatus(phone)
      }
    }

    return NextResponse.json({ healthy, url: SIGNAL_API, accounts, pinStatus })
  } catch {
    return NextResponse.json({ healthy: false, url: SIGNAL_API, accounts: [], pinStatus: {} })
  }
}
