import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  // Get current state before update
  const currentKeys = services.keys.list()
  const currentKey = currentKeys.find((k) => k.id === id)

  const key = services.keys.update(id, body)
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If assignedTo changed, sync .env files
  if (body.assignedTo && currentKey) {
    const decrypted = services.keys.getDecryptedValue(id)
    if (decrypted) {
      const added = body.assignedTo.filter((h: string) => !currentKey.assignedTo.includes(h))
      const removed = currentKey.assignedTo.filter((h: string) => !body.assignedTo.includes(h))

      for (const h of added) {
        services.keys.writeKeyToEnv(h, key.provider, decrypted)
      }
      for (const h of removed) {
        services.keys.removeKeyFromEnv(h, key.provider)
      }
    }
  }

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
