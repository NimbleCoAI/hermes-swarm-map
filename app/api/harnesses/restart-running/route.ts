import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function POST() {
  const result = services.harness.restartRunning()
  return NextResponse.json(result)
}
