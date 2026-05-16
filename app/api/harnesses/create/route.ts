import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { name, tier, platform, channel, models } = body

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  try {
    const result = services.harness.createOverlay({ name: name.trim(), tier, platform, channel, models })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 409 }
    )
  }
}
