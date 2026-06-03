import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()

  const currentKeys = services.keys.list()
  const currentKey = currentKeys.find((k) => k.id === id)

  // If a new value is provided, rotate + update metadata in one operation
  if (body.value) {
    const { value, ...metadata } = body
    const rotated = services.keys.rotateValue(id, value, metadata)
    if (!rotated) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    // Recreate all affected harnesses so the rotated value loads
    // (env_file is read at container creation, not on a plain restart).
    const allAffected = new Set([
      ...(rotated.assignedTo ?? []),
      ...(currentKey?.assignedTo ?? []),
    ])
    for (const harnessId of allAffected) {
      try { services.harness.restart(harnessId, 'recreate') } catch {}
    }
    return NextResponse.json(rotated)
  }

  // No value change — update metadata only
  const key = services.keys.update(id, body)
  if (!key) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If assignedTo changed, sync .env files and restart affected harnesses
  if (body.assignedTo && currentKey) {
    const decrypted = services.keys.getDecryptedValue(id)
    if (decrypted) {
      const added = body.assignedTo.filter((h: string) => !currentKey.assignedTo.includes(h))
      const removed = currentKey.assignedTo.filter((h: string) => !body.assignedTo.includes(h))
      for (const h of added) {
        services.keys.writeKeyToEnv(h, key.provider, decrypted)
        try { services.harness.restart(h, 'recreate') } catch {}
      }
      for (const h of removed) {
        services.keys.removeKeyFromEnv(h, key.provider)
        try { services.harness.restart(h, 'recreate') } catch {}
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
