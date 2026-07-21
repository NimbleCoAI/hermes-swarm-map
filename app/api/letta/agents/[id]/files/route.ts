// A3: read one agent's memfs context-file view — the "what's in context right
// now" surface (open files + visible content). Read-only; proxied same-origin so
// the Letta base URL stays server-side. `?open=1` lists only currently-open files.
import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const url = new URL(request.url)
  const openOnly = url.searchParams.get('open') === '1'
  try {
    return NextResponse.json(
      await services.letta.listFiles(id, openOnly ? { isOpen: true } : undefined),
    )
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read context files' },
      { status: 502 },
    )
  }
}
