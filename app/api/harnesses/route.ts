import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  try {
    const { harnesses, error } = services.harness.discover()

    if (error && harnesses.length === 0) {
      // Docker unavailable — fall back to stored overlays
      const stored = services.storage.read<unknown[]>('harnesses.json', [])
      return NextResponse.json(stored)
    }

    return NextResponse.json(harnesses)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, harnesses: [] }, { status: 500 })
  }
}
