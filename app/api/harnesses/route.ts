import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  try {
    const harnesses = services.harness.list()
    return NextResponse.json(harnesses)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message, harnesses: [] }, { status: 500 })
  }
}
