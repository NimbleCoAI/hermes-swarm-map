import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const who = url.searchParams.get('who') || undefined
  const what = url.searchParams.get('what') || undefined
  const since = url.searchParams.get('since')
    ? Number(url.searchParams.get('since'))
    : undefined
  const entries = services.audit.query({ who, what, since })
  return NextResponse.json(entries)
}
