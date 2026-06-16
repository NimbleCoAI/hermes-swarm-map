// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services', () => ({
  services: { harness: { syncArtifacts: vi.fn() } },
}))

import { POST } from './route'
import { services } from '@/lib/services'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}
function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/harnesses/h_test/artifacts/sync', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/harnesses/:id/artifacts/sync', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes dryRun/force through and returns the service result', async () => {
    ;(services.harness.syncArtifacts as any).mockReturnValue({
      ok: true, serviceName: 'hermes-test', dryRun: true, results: [], pluginsEnabled: [], restarted: false,
    })
    const res = await POST(makeRequest({ dryRun: true, force: true }), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, dryRun: true })
    expect(services.harness.syncArtifacts).toHaveBeenCalledWith('h_test', { dryRun: true, force: true })
  })

  it('defaults dryRun/force to false on empty body', async () => {
    ;(services.harness.syncArtifacts as any).mockReturnValue({ ok: true })
    await POST(new Request('http://localhost/x', { method: 'POST' }), makeParams('h_test'))
    expect(services.harness.syncArtifacts).toHaveBeenCalledWith('h_test', { dryRun: false, force: false })
  })

  it('maps a not-found error to 404', async () => {
    ;(services.harness.syncArtifacts as any).mockImplementation(() => { throw new Error('Harness h_x not found') })
    const res = await POST(makeRequest({}), makeParams('h_x'))
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/not found/i) })
  })

  it('maps an unexpected error to 500', async () => {
    ;(services.harness.syncArtifacts as any).mockImplementation(() => { throw new Error('disk exploded') })
    const res = await POST(makeRequest({}), makeParams('h_test'))
    expect(res.status).toBe(500)
  })
})
