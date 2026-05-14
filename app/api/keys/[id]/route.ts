import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const key = services.keys.update(id, body)
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(key)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const removed = services.keys.remove(id)
  if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
