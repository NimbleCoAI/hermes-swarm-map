// Slice 1: Letta agents (+ the Letta server) mapped to Harness objects, so the
// fleet list can render them alongside container harnesses. Read-only. See
// design §1c / §4b. Distinct from /api/harnesses (sync container discovery) —
// this path is async REST against the Letta server.
import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  try {
    return NextResponse.json(await services.lettaAgents.list())
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list Letta harnesses', harnesses: [] },
      { status: 502 },
    )
  }
}
