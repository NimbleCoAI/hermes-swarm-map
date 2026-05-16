import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(_request.url)
  const lines = parseInt(url.searchParams.get('lines') ?? '100', 10)

  const harness = services.harness.get(id)
  if (!harness) {
    return NextResponse.json({ error: 'Harness not found' }, { status: 404 })
  }

  if (!harness.composeFile || !harness.serviceName) {
    return NextResponse.json({ error: 'No compose config for this harness' }, { status: 400 })
  }

  const logs = services.docker.getLogs(harness.composeFile, harness.serviceName, lines)
  return NextResponse.json({ logs, lines })
}
