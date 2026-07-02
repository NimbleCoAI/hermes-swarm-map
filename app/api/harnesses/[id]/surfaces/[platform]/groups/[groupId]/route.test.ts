/**
 * Tests for the is-group-allowed route the swarm_map_policy plugin calls.
 * GET /api/harnesses/:id/surfaces/:platform/groups/:groupId → { allowed }
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET } from './route'

vi.mock('@/lib/services', () => ({
  services: { surfaceAdmins: { isGroupAllowed: vi.fn() } },
}))

import { services } from '@/lib/services'
const isGroupAllowed = services.surfaceAdmins.isGroupAllowed as ReturnType<typeof vi.fn>

function makeParams(id: string, platform: string, groupId: string) {
  return { params: Promise.resolve({ id, platform, groupId }) }
}

beforeEach(() => vi.clearAllMocks())

describe('GET is-group-allowed', () => {
  it('returns { allowed: true } (200) when the service allows the group', async () => {
    isGroupAllowed.mockReturnValue(true)
    const res = await GET(new Request('http://x'), makeParams('h_seraph', 'signal', 'g1'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ allowed: true })
    expect(isGroupAllowed).toHaveBeenCalledWith('h_seraph', 'signal', 'g1')
  })

  it('returns { allowed: false } (200, fail-closed) for an unlisted group', async () => {
    isGroupAllowed.mockReturnValue(false)
    const res = await GET(new Request('http://x'), makeParams('h_seraph', 'signal', 'gX'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ allowed: false })
  })
})
