import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'

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
    await execAsync(
      `docker exec ${CONTAINER} signal-cli -a ${phone} verify ${cleanCode}`,
      { timeout: 30000 }
    )

    if (displayName) {
      await execAsync(
        `docker exec ${CONTAINER} signal-cli -a ${phone} updateProfile --given-name '${displayName.replace(/'/g, "'\\''")}'`,
        { timeout: 15000 }
      ).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string }
    const output = (err.stderr || '') + (err.message || '')
    const match = output.match(/Failed to verify: (.+)/)?.[1] || 'Verification failed'
    return NextResponse.json({ success: false, error: match }, { status: 500 })
  }
}
