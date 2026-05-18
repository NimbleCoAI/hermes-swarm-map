import { NextResponse } from 'next/server'

const SIGNAL_API = process.env.SIGNAL_API_URL || 'http://localhost:8080'

export async function POST(request: Request) {
  const { phone, captcha } = await request.json() as { phone: string; captcha?: string }

  if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
    return NextResponse.json({ success: false, error: 'Invalid phone number (E.164 format required)' }, { status: 400 })
  }

  try {
    const body: Record<string, unknown> = { use_voice: false }
    if (captcha) body.captcha = captcha

    const res = await fetch(`${SIGNAL_API}/v1/register/${encodeURIComponent(phone)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })

    if (res.ok) {
      return NextResponse.json({ success: true })
    }

    const text = await res.text()
    let data: { error?: string } = {}
    try { data = JSON.parse(text) } catch { data = { error: text } }
    const error = data.error || text

    if (error.toLowerCase().includes('captcha')) {
      return NextResponse.json({ success: false, needsCaptcha: true, error: 'Captcha required — solve at https://signalcaptchas.org/registration/generate.html and paste the token' })
    }

    if (error.toLowerCase().includes('rate limit') || res.status === 429) {
      return NextResponse.json({ success: false, error: 'Rate limited by Signal. Wait a few minutes and try again.' }, { status: 429 })
    }

    return NextResponse.json({ success: false, error: error || 'Registration failed' }, { status: res.status })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Registration failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
