import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

/**
 * /api/harnesses/:id/tools/discover
 *
 * GET  — Scans the agent's config.yaml and skills directory to discover
 *        runtime tools. Strictly read-only: returns discovered tool IDs
 *        without persisting anything. The legacy `?sync=true` query param is
 *        ignored (issue #141: it used to write via GET, riding past the
 *        auth-gate middleware which passes GET/HEAD through unconditionally).
 *
 * POST — Discovers AND persists the discovered tools into the harness
 *        overlay, but only if no tools have been explicitly assigned via
 *        PUT ../tools. As a mutation, POST is gated by the operator-session
 *        middleware like every other state-changing route.
 */

function discoverPayload(harness: { name: string; tools: string[] }) {
  const discovered = services.tools.discoverForHarness(harness.name)

  // Resolve discovered IDs to full tool objects for richer response
  const allTools = services.tools.list()
  const toolMap = new Map(allTools.map((t) => [t.id, t]))
  const resolvedTools = discovered.map((tid) => toolMap.get(tid)).filter(Boolean)

  return { discovered, resolvedTools }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const harness = services.harness.get(id)
  if (!harness) {
    return NextResponse.json({ error: 'Harness not found' }, { status: 404 })
  }

  const { discovered, resolvedTools } = discoverPayload(harness)

  return NextResponse.json({
    discovered: resolvedTools,
    discoveredIds: discovered,
    currentTools: harness.tools,
    synced: false,
  })
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const harness = services.harness.get(id)
  if (!harness) {
    return NextResponse.json({ error: 'Harness not found' }, { status: 404 })
  }

  const { discovered, resolvedTools } = discoverPayload(harness)

  // Only auto-populate when nothing was explicitly assigned and discovery
  // actually found tools — same bounded semantics as the old GET ?sync=true.
  let synced = false
  if (harness.tools.length === 0 && discovered.length > 0) {
    services.harness.updateConfig(id, { tools: discovered })
    synced = true
  }

  return NextResponse.json({
    discovered: resolvedTools,
    discoveredIds: discovered,
    currentTools: synced ? discovered : harness.tools,
    synced,
  })
}
