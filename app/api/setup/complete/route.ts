import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function POST() {
  const settings = services.config.updateSettings({ onboarded: true })
  return NextResponse.json({ ok: true, settings })
}
