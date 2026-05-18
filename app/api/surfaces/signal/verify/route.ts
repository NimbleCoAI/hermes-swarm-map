import { NextResponse } from 'next/server'

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
    // Verify via bbernhard REST API
    const verifyRes = await fetch(`${SIGNAL_API}/v1/register/${encodeURIComponent(phone)}/verify/${cleanCode}`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
    })

    if (!verifyRes.ok) {
      const text = await verifyRes.text()
      let data: { error?: string } = {}
      try { data = JSON.parse(text) } catch { data = { error: text } }
      return NextResponse.json({ success: false, error: data.error || 'Verification failed' }, { status: verifyRes.status })
    }

    // Set display name if provided
    if (displayName) {
      await fetch(`${SIGNAL_API}/v1/profiles/${encodeURIComponent(phone)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => {})
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Verification failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
