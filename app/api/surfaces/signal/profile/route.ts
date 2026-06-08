import { NextResponse } from 'next/server'
import { callSignalRpc } from '@/lib/env-helpers'

/**
 * Set a Signal account's profile (display) name — the name contacts see when
 * they DM the agent's number. This lives in the signal-cli daemon, not HSM/.env,
 * so it's the only way to correct a mis-named account (e.g. a duplicate that
 * advertised its source's name).
 *
 * POST { phone, displayName } -> signal-cli `updateProfile`.
 */
export async function POST(request: Request) {
  let body: { phone?: string; displayName?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const phone = (body.phone || '').trim()
  const displayName = (body.displayName || '').trim()
  if (!phone || !displayName) {
    return NextResponse.json(
      { success: false, error: 'phone and displayName are required' },
      { status: 400 },
    )
  }

  try {
    const rpc = await callSignalRpc('updateProfile', {
      account: phone,
      'given-name': displayName,
    })
    if (rpc.error) {
      return NextResponse.json(
        { success: false, error: rpc.error.message || 'updateProfile failed' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'updateProfile failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
