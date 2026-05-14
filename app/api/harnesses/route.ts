import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  const harnesses = services.harness.list()
  return NextResponse.json(harnesses)
}
