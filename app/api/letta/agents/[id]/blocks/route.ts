// SPIKE (Path 1): read one agent's core-memory blocks — the granularity the
// "Librarian in an Airlock" use-case hangs on. Read-only.
import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  try {
    return NextResponse.json(await services.letta.getMemoryBlocks(id))
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to read memory blocks' },
      { status: 502 },
    )
  }
}
