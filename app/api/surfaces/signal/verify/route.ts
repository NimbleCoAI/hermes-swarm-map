import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'
const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function POST(request: Request) {
  const { phone, code, displayName } = await request.json() as {
    phone: string; code: string; displayName?: string
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

    // Confirm registration via JSON-RPC
    try {
      const rpcRes = await fetch(`${SIGNAL_API}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: '1' }),
        signal: AbortSignal.timeout(5000),
      })
      const rpcData = await rpcRes.json()
      const registered = Array.isArray(rpcData.result) &&
        rpcData.result.some((a: { number?: string }) => a.number === phone)
      if (!registered) {
        return NextResponse.json({ success: false, error: 'Verification appeared to succeed but account not found in daemon. Try again.' }, { status: 500 })
      }
    } catch {
      // Non-fatal
    }

    if (displayName) {
      await execAsync(
        `docker exec ${CONTAINER} signal-cli --config /home/.local/share/signal-cli -a ${phone} updateProfile --given-name '${displayName.replace(/'/g, "'\\''")}'`,
        { timeout: 15000 }
      ).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const output = (err.stderr || '') + (err.stdout || '') + (err.message || '')
    const match = output.match(/Failed to verify: (.+)/)?.[1] || 'Verification failed'
    return NextResponse.json({ success: false, error: match }, { status: 500 })
  }
}
