import { NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'

export async function POST(request: Request) {
  const { phone, captcha } = await request.json() as { phone: string; captcha?: string }

  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return NextResponse.json({ success: false, error: 'Invalid phone number (E.164 format required)' }, { status: 400 })
  }

  const captchaArg = captcha ? ` --captcha '${captcha.replace(/'/g, "'\\''")}'` : ''
  const cmd = `docker exec ${CONTAINER} signal-cli -a ${phone} register${captchaArg}`

  try {
    await execAsync(cmd, { timeout: 30000 })
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const output = (err.stderr || '') + (err.stdout || '') + (err.message || '')

    if (output.toLowerCase().includes('captcha')) {
      return NextResponse.json({ success: false, needsCaptcha: true })
    }

    const match = output.match(/Failed to register: (.+)/)?.[1] || output.split('\n').pop()
    return NextResponse.json({ success: false, error: match || 'Registration failed' }, { status: 500 })
  }
}
