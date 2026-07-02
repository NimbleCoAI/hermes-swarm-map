// @vitest-environment node
/**
 * Tests for /api/harnesses/:id/tools/discover.
 *
 * The root middleware gates POST/PUT/PATCH/DELETE behind the operator session
 * cookie but intentionally passes GET/HEAD unauthenticated (agents' read
 * hot-paths). GET must therefore be a pure read: the old `?sync=true` branch
 * let a cookie-less agent container trigger a persistent write (issue #141).
 * The sync-and-persist behavior lives on POST, which the middleware gates.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services', () => ({
  services: {
    harness: { get: vi.fn(), updateConfig: vi.fn() },
    tools: { discoverForHarness: vi.fn(() => []), list: vi.fn(() => []) },
  },
}))

import { GET, POST } from './route'
import { services } from '@/lib/services'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(method: string, query = ''): Request {
  return new Request(`http://localhost/api/harnesses/h_test/tools/discover${query}`, { method })
}

const harness = (tools: string[]) => ({ id: 'h_test', name: 'test-agent', tools })

const toolList = [
  { id: 'tool_a', name: 'Tool A' },
  { id: 'tool_b', name: 'Tool B' },
]

describe('Tools discover API — GET is a pure read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns discovered tools without persisting', async () => {
    vi.mocked(services.harness.get).mockReturnValue(harness([]) as never)
    vi.mocked(services.tools.discoverForHarness).mockReturnValue(['tool_a', 'tool_b'])
    vi.mocked(services.tools.list).mockReturnValue(toolList as never)

    const res = await GET(makeRequest('GET'), makeParams('h_test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discoveredIds).toEqual(['tool_a', 'tool_b'])
    expect(body.discovered).toEqual(toolList)
    expect(body.currentTools).toEqual([])
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
  })

  it('ignores ?sync=true — never writes, never reports a sync', async () => {
    vi.mocked(services.harness.get).mockReturnValue(harness([]) as never)
    vi.mocked(services.tools.discoverForHarness).mockReturnValue(['tool_a'])
    vi.mocked(services.tools.list).mockReturnValue(toolList as never)

    const res = await GET(makeRequest('GET', '?sync=true'), makeParams('h_test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
    expect(body.synced).not.toBe(true)
  })

  it('404s on unknown harness', async () => {
    vi.mocked(services.harness.get).mockReturnValue(undefined as never)
    const res = await GET(makeRequest('GET'), makeParams('h_missing'))
    expect(res.status).toBe(404)
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
  })
})

describe('Tools discover API — POST syncs discovered tools', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists discovered tools when the harness has none assigned', async () => {
    vi.mocked(services.harness.get).mockReturnValue(harness([]) as never)
    vi.mocked(services.tools.discoverForHarness).mockReturnValue(['tool_a', 'tool_b'])
    vi.mocked(services.tools.list).mockReturnValue(toolList as never)

    const res = await POST(makeRequest('POST'), makeParams('h_test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).toHaveBeenCalledWith('h_test', {
      tools: ['tool_a', 'tool_b'],
    })
    expect(body.synced).toBe(true)
    expect(body.discoveredIds).toEqual(['tool_a', 'tool_b'])
    expect(body.discovered).toEqual(toolList)
    // The response must reflect the post-write truth, not the pre-sync snapshot.
    expect(body.currentTools).toEqual(['tool_a', 'tool_b'])
  })

  it('does NOT persist when the harness already has tools assigned', async () => {
    vi.mocked(services.harness.get).mockReturnValue(harness(['tool_existing']) as never)
    vi.mocked(services.tools.discoverForHarness).mockReturnValue(['tool_a'])
    vi.mocked(services.tools.list).mockReturnValue(toolList as never)

    const res = await POST(makeRequest('POST'), makeParams('h_test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
    expect(body.synced).toBe(false)
    expect(body.currentTools).toEqual(['tool_existing'])
  })

  it('does NOT persist when discovery finds nothing', async () => {
    vi.mocked(services.harness.get).mockReturnValue(harness([]) as never)
    vi.mocked(services.tools.discoverForHarness).mockReturnValue([])
    vi.mocked(services.tools.list).mockReturnValue(toolList as never)

    const res = await POST(makeRequest('POST'), makeParams('h_test'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
    expect(body.synced).toBe(false)
    expect(body.discoveredIds).toEqual([])
  })

  it('404s on unknown harness', async () => {
    vi.mocked(services.harness.get).mockReturnValue(undefined as never)
    const res = await POST(makeRequest('POST'), makeParams('h_missing'))
    expect(res.status).toBe(404)
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
  })
})
