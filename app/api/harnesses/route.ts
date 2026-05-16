import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  try {
    const { harnesses, error } = services.harness.discover()

    if (error && harnesses.length === 0) {
      // Docker unavailable — fall back to stored overlays and signal the error
      const stored = services.storage.read<unknown[]>('harnesses.json', [])
      return NextResponse.json(
        { harnesses: stored, error },
        { status: 207 }  // partial content
      )
    }

    // Success — may include a non-fatal warning (e.g. some files not found)
    if (error) {
      return NextResponse.json({ harnesses, error }, { status: 207 })
    }

    return NextResponse.json(harnesses)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, harnesses: [] }, { status: 500 })
  }
}
