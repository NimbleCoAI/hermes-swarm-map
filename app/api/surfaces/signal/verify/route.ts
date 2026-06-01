import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'
const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function POST(request: Request) {
  const { phone, code, displayName, pin, harnessId } = await request.json() as {
    phone: string; code: string; displayName?: string; pin?: string; harnessId?: string
  }

  if (!phone || !code) {
    return NextResponse.json({ success: false, error: 'Phone and code required' }, { status: 400 })
  }

  if (!/^\d{6}$/.test(code.replace(/[- ]/g, ''))) {
    return NextResponse.json({ success: false, error: 'Code must be 6 digits' }, { status: 400 })
  }

  const cleanCode = code.replace(/[- ]/g, '')

  try {
    const { stdout, stderr } = await execAsync(
      `docker exec ${CONTAINER} signal-cli --config /home/.local/share/signal-cli -a ${phone} verify ${cleanCode}`,
      { timeout: 30000 }
    )
    const output = (stderr || '') + (stdout || '')

    if (output.includes('Failed to verify') || output.includes('Invalid verification code')) {
      const match = output.match(/Failed to verify: (.+)/)?.[1] || 'Verification failed'
      return NextResponse.json({ success: false, error: match }, { status: 400 })
    }

    // Restart daemon so it picks up the newly registered account
    // (docker exec registers outside the running daemon process)
    await execAsync(`docker restart ${CONTAINER}`, { timeout: 30000 }).catch(() => {})

    // Wait for daemon to come back up
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 2000))
      try {
        const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
          signal: AbortSignal.timeout(3000),
        })
        const rpcData = await rpcRes.json()
        const registered = Array.isArray(rpcData.result) &&
          rpcData.result.some((a: { number?: string }) => a.number === phone)
        if (registered) break
      } catch {
        // Daemon still restarting, retry
      }
    }

    const profileName = displayName || 'Hermes Agent'
    await execAsync(
      `docker exec ${CONTAINER} signal-cli --config /home/.local/share/signal-cli -a ${phone} updateProfile --given-name '${profileName.replace(/'/g, "'\\''")}'`,
      { timeout: 15000 }
    ).catch(() => {})

    // Set registration lock PIN if provided
    let pinSet = false
    if (pin && harnessId) {
      const { services } = await import('@/lib/services')
      const pinResult = await services.signalPin.setPin(phone, pin, harnessId)
      pinSet = pinResult.success
    }

    return NextResponse.json({ success: true, pinSet })
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const output = (err.stderr || '') + (err.stdout || '') + (err.message || '')
    const match = output.match(/Failed to verify: (.+)/)?.[1] || 'Verification failed'
    return NextResponse.json({ success: false, error: match }, { status: 500 })
  }
}
