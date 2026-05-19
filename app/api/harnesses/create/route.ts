import { NextResponse } from 'next/server'
import { services } from '@/lib/services'
import { getDefaultToolsForTier } from '@/lib/services/tools'
import type { HabitatTier } from '@/lib/types'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { name, tier, platform, channel, models } = body

  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  // Compute default tools for the chosen tier
  const effectiveTier: HabitatTier = tier ?? 'individual'
  const allTools = services.tools.list()
  const defaultTools = getDefaultToolsForTier(effectiveTier, allTools)

  try {
    const result = services.harness.createOverlay({
      name: name.trim(),
      tier,
      platform,
      channel,
      models,
      tools: defaultTools,
    })
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Create failed' },
      { status: 409 }
    )
  }
}
