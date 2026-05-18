import { NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const CONTAINER = process.env.SIGNAL_CONTAINER || 'signal-cli-daemon'

export async function POST(request: Request) {
  const { phone, captcha } = await request.json() as { phone: string; captcha?: string }

  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return NextResponse.json({ success: false, error: 'Invalid phone number (E.164 format required)' }, { status: 400 })
  }

  // Use execFile (no shell) to avoid escaping issues with long captcha tokens
  const args = ['exec', CONTAINER, 'signal-cli', '--config', '/home/.local/share/signal-cli', '-a', phone, 'register']
  if (captcha) args.push('--captcha', captcha)

  try {
    const { stdout, stderr } = await execFileAsync('docker', args, { timeout: 30000 })
    const output = (stderr || '') + (stdout || '')

    if (output.toLowerCase().includes('invalid captcha')) {
      return NextResponse.json({ success: false, needsCaptcha: true, error: 'Invalid captcha token — please solve a new captcha and try again' })
    }

    if (output.toLowerCase().includes('captcha required') || (output.toLowerCase().includes('captcha') && !captcha)) {
      return NextResponse.json({ success: false, needsCaptcha: true, error: 'Captcha required — solve at https://signalcaptchas.org/registration/generate.html and paste the token' })
    }

    if (output.toLowerCase().includes('rate limit') || output.includes('429')) {
      return NextResponse.json({ success: false, error: 'Rate limited by Signal. Wait a few minutes and try again.' }, { status: 429 })
    }

    if (output.includes('Failed to register')) {
      const match = output.match(/Failed to register: (.+)/)?.[1]
      return NextResponse.json({ success: false, error: match || 'Registration failed' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const err = error as { stderr?: string; stdout?: string; message?: string }
    const output = (err.stderr || '') + (err.stdout || '') + (err.message || '')

    if (output.toLowerCase().includes('invalid captcha')) {
      return NextResponse.json({ success: false, needsCaptcha: true, error: 'Invalid captcha token — please solve a new captcha and try again' })
    }

    if (output.toLowerCase().includes('captcha required') || (output.toLowerCase().includes('captcha') && !captcha)) {
      return NextResponse.json({ success: false, needsCaptcha: true, error: 'Captcha required — solve at https://signalcaptchas.org/registration/generate.html and paste the token' })
    }

    if (output.toLowerCase().includes('rate limit') || output.includes('429')) {
      return NextResponse.json({ success: false, error: 'Rate limited by Signal. Wait a few minutes and try again.' }, { status: 429 })
    }

    const match = output.match(/Failed to register: (.+)/)?.[1] || output.split('\n').pop()
    return NextResponse.json({ success: false, error: match || 'Registration failed' }, { status: 500 })
  }
}
