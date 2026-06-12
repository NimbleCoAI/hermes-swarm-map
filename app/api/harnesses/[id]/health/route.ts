import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

// GET /api/harnesses/:id/health → canary signal (healthy | starting | unhealthy)
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    return NextResponse.json(services.harness.agentHealth(id))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'health check failed'
    return NextResponse.json({ error: msg }, { status: /not found/i.test(msg) ? 404 : 500 })
  }
}
