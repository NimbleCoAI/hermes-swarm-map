import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

// POST /api/harnesses/:id/artifacts/sync
// Body (optional): { dryRun?: boolean, force?: boolean }
//   dryRun → return the plan without copying files or restarting the container
//   force  → overwrite even user-modified artifacts (default never clobbers)
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const dryRun = body?.dryRun === true
  const force = body?.force === true
  try {
    const result = services.harness.syncArtifacts(id, { dryRun, force })
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'artifacts sync failed'
    const status = /not found/i.test(msg) ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
