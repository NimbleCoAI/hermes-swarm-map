import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const model = services.config.updateModel(id, body)
  if (!model) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(model)
}
