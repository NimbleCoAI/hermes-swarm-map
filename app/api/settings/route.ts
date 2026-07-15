import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  return NextResponse.json(services.config.getSettings())
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null)
  try {
    const settings = services.config.updateSettings(body)
    return NextResponse.json(settings)
  } catch (err) {
    // validateSettingsPatch rejects unknown keys, wrong types, and injecting values.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid settings' },
      { status: 400 },
    )
  }
}
