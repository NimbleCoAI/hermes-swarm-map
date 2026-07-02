/**
 * Tests for the surface admin list/set routes.
 *
 * GET /api/harnesses/:id/surfaces/:platform/admins
 * PUT /api/harnesses/:id/surfaces/:platform/admins   body: { admins, actor }
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET, PUT } from './route'

vi.mock('@/lib/services', () => ({
  services: {
    surfaceAdmins: {
      listAdmins: vi.fn(),
      setAdmins: vi.fn(),
    },
  },
}))

import { services } from '@/lib/services'

const listAdmins = services.surfaceAdmins.listAdmins as ReturnType<typeof vi.fn>
const setAdmins = services.surfaceAdmins.setAdmins as ReturnType<typeof vi.fn>

function makeParams(id: string, platform: string) {
  return { params: Promise.resolve({ id, platform }) }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET admins', () => {
  it('returns the admin list from the service', async () => {
    listAdmins.mockReturnValue({ platform: 'signal', admins: ['+64111'], source: 'allowlist', allowAllDm: false })
    const res = await GET(new Request('http://x'), makeParams('h_seraph', 'signal'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ platform: 'signal', admins: ['+64111'], source: 'allowlist', allowAllDm: false })
    expect(listAdmins).toHaveBeenCalledWith('h_seraph', 'signal')
  })

  it('returns 400 for an unsupported platform', async () => {
    const res = await GET(new Request('http://x'), makeParams('h_seraph', 'whatsapp'))
    expect(res.status).toBe(400)
    expect(listAdmins).not.toHaveBeenCalled()
  })
})

describe('PUT admins', () => {
  it('200 + persisted list when the service authorizes', async () => {
    setAdmins.mockReturnValue({ ok: true, admins: ['+64222'] })
    const req = new Request('http://x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admins: ['+64222'], actor: '+64111' }),
    })
    const res = await PUT(req, makeParams('h_seraph', 'signal'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, admins: ['+64222'] })
    expect(setAdmins).toHaveBeenCalledWith('h_seraph', 'signal', ['+64222'], '+64111')
  })

  it('403 when the service rejects a non-admin actor (self-escalation guard)', async () => {
    setAdmins.mockReturnValue({ ok: false, status: 403, error: 'actor is not an admin for this surface' })
    const req = new Request('http://x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admins: ['+64999'], actor: '+64999' }),
    })
    const res = await PUT(req, makeParams('h_seraph', 'signal'))
    expect(res.status).toBe(403)
  })

  it('400 for malformed identities (service result)', async () => {
    setAdmins.mockReturnValue({ ok: false, status: 400, error: 'Invalid signal identity: bad' })
    const req = new Request('http://x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admins: ['bad'], actor: '+64111' }),
    })
    const res = await PUT(req, makeParams('h_seraph', 'signal'))
    expect(res.status).toBe(400)
  })

  it('400 for invalid JSON body', async () => {
    const req = new Request('http://x', { method: 'PUT', body: 'not json' })
    const res = await PUT(req, makeParams('h_seraph', 'signal'))
    expect(res.status).toBe(400)
    expect(setAdmins).not.toHaveBeenCalled()
  })

  it('passes an empty actor through to the service (which rejects it)', async () => {
    setAdmins.mockReturnValue({ ok: false, status: 400, error: 'actor is required' })
    const req = new Request('http://x', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ admins: ['+64222'] }),
    })
    const res = await PUT(req, makeParams('h_seraph', 'signal'))
    expect(res.status).toBe(400)
    expect(setAdmins).toHaveBeenCalledWith('h_seraph', 'signal', ['+64222'], '')
  })
})
