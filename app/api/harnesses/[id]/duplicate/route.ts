import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const newName = body.name

  if (!newName || typeof newName !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const trimmed = newName.trim()

  // Check if name already exists before attempting duplicate
  const existing = services.harness.get(
    'h_' + trimmed.replace(/-/g, '_').replace(/\s+/g, '_')
  )
  if (existing) {
    return NextResponse.json(
      { error: `Harness "${trimmed}" already exists` },
      { status: 409 }
    )
  }

  const result = await services.harness.duplicateOverlay(id, trimmed)
  if (!result) {
    return NextResponse.json({ error: 'Source harness not found' }, { status: 404 })
  }

  return NextResponse.json(result, { status: 201 })
}
