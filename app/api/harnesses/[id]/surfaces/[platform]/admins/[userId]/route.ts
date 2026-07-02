import { NextResponse } from 'next/server'
import { services } from '@/lib/services'

/**
 * GET /api/harnesses/:id/surfaces/:platform/admins/:userId
 *
 * The is-admin check the swarm_map_policy plugin calls per message
 * (is_platform_admin → resp.json().get("is_admin", False)). Always returns 200
 * with a boolean so the plugin gets a clean fail-closed answer; never 404/500
 * on the hot path, and never leaks which users exist.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; platform: string; userId: string }> },
) {
  const { id, platform, userId } = await params
  const isAdmin = services.surfaceAdmins.isAdmin(id, platform, decodeURIComponent(userId))
  return NextResponse.json({ is_admin: isAdmin })
}
