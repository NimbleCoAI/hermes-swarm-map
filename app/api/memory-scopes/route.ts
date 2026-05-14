import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  return NextResponse.json(services.memory.list())
}
