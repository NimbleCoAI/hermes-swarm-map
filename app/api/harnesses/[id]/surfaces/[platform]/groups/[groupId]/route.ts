import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

/**
 * GET /api/harnesses/:id/surfaces/:platform/groups/:groupId
 *
 * The is-group-allowed check the swarm_map_policy plugin calls
 * (is_group_allowed → resp.json().get("allowed", False)). Mirrors the existing
 * /policy?action=group-check logic at the REST path the plugin expects. Always
 * returns 200 with a boolean so the plugin fails closed cleanly.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; platform: string; groupId: string }> },
) {
  const { id, platform, groupId } = await params
  const allowed = services.surfaceAdmins.isGroupAllowed(id, platform, decodeURIComponent(groupId))
  return NextResponse.json({ allowed })
}
