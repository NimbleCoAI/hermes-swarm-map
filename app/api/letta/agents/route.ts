// SPIKE (Path 1): proxy the Letta server's agent list through HSM so the
// read-only view can fetch it same-origin (the Letta base URL is server-side
// config, not something the browser should reach directly).
import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

export async function GET() {
  try {
    return NextResponse.json(await services.letta.listAgents())
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list Letta agents' },
      { status: 502 },
    )
  }
}
