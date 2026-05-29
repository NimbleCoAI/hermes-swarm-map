import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

/**
 * GET /api/harnesses/:id/tools/discover
 *
 * Scans the agent's config.yaml and skills directory to discover runtime tools.
 * Returns discovered tool IDs without persisting them — use PUT ../tools to save.
 *
 * Query params:
 *   ?sync=true — also persist the discovered tools into the harness overlay
 *                (only if no tools have been explicitly assigned via PUT)
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const harness = services.harness.get(id)
  if (!harness) {
    return NextResponse.json({ error: 'Harness not found' }, { status: 404 })
  }

  const discovered = services.tools.discoverForHarness(harness.name)

  // Resolve discovered IDs to full tool objects for richer response
  const allTools = services.tools.list()
  const toolMap = new Map(allTools.map((t) => [t.id, t]))
  const resolvedTools = discovered.map((tid) => toolMap.get(tid)).filter(Boolean)

  // Optionally sync discovered tools into overlay
  const url = new URL(request.url)
  const sync = url.searchParams.get('sync') === 'true'

  let synced = false
  if (sync && harness.tools.length === 0 && discovered.length > 0) {
    services.harness.updateConfig(id, { tools: discovered })
    synced = true
  }

  return NextResponse.json({
    discovered: resolvedTools,
    discoveredIds: discovered,
    currentTools: harness.tools,
    synced,
  })
}
