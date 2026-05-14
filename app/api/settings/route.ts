import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  return NextResponse.json(services.config.getSettings())
}

export async function PUT(request: Request) {
  const body = await request.json()
  const settings = services.config.updateSettings(body)
  return NextResponse.json(settings)
}
