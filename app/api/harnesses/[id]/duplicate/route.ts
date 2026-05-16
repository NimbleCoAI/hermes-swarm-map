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

  const result = services.harness.duplicateOverlay(id, newName.trim())
  if (!result) {
    return NextResponse.json({ error: 'Source harness not found' }, { status: 404 })
  }

  return NextResponse.json(result, { status: 201 })
}
