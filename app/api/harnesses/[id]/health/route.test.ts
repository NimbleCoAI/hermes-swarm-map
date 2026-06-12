// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services', () => ({
  services: { harness: { agentHealth: vi.fn() } },
}))
import { GET } from './route'
import { services } from '@/lib/services'

const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/harnesses/:id/health', () => {
  beforeEach(() => vi.clearAllMocks())
  it('returns the canary status', async () => {
    ;(services.harness.agentHealth as any).mockReturnValue({ status: 'healthy', running: true, restartCount: 0, uptimeSec: 42 })
    const res = await GET(new Request('http://x'), params('h_a'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'healthy' })
  })
  it('404s on unknown harness', async () => {
    ;(services.harness.agentHealth as any).mockImplementation(() => { throw new Error('Harness h_x not found') })
    expect((await GET(new Request('http://x'), params('h_x'))).status).toBe(404)
  })
})
