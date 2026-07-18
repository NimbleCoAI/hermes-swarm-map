// SPIKE (Path 1): send a message to one Letta agent. The single "action" of the
// otherwise read-only view.
import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    const body = await request.json().catch(() => ({}))
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (!text) {
      return NextResponse.json({ error: 'Message text is required' }, { status: 400 })
    }
    return NextResponse.json(await services.letta.sendMessage(id, text))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to send message' },
      { status: 502 },
    )
  }
}
