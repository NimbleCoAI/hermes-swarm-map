import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import type { RestartMode } from '@/lib/types'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const mode: RestartMode = body.mode || 'quick'
  try {
    services.harness.restart(id, mode)
    return NextResponse.json({ ok: true, mode })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Restart failed' },
      { status: 500 }
    )
  }
}
