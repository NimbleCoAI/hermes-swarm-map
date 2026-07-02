// @vitest-environment node
/**
 * Tests for /api/harnesses/:id/tools/discover.
 *
 * Issue #141: the ?sync=true branch used to write via GET
 * (services.harness.updateConfig on a read request). The auth-gate middleware
 * passes GET/HEAD through unconditionally, so a cookie-less agent container
 * could trigger a state write. The sync side-effect now lives on POST, which
 * the middleware gates like every other mutation.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/lib/services', () => ({
  services: {
    harness: {
      get: vi.fn(),
      updateConfig: vi.fn(),
    },
    tools: {
      discoverForHarness: vi.fn(() => []),
      list: vi.fn(() => []),
    },
  },
}))

import { GET, POST } from './route'
import { services } from '@/lib/services'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeHarness(overrides: Record<string, unknown> = {}) {
  return { id: 'h_test', name: 'test-agent', tools: [], ...overrides }
}

const TOOL_A = { id: 'tool-a', name: 'Tool A' }
const TOOL_B = { id: 'tool-b', name: 'Tool B' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(services.harness.get).mockReturnValue(makeHarness() as never)
  vi.mocked(services.tools.discoverForHarness).mockReturnValue(['tool-a', 'tool-b'])
  vi.mocked(services.tools.list).mockReturnValue([TOOL_A, TOOL_B] as never)
})

describe('GET /api/harnesses/:id/tools/discover — read-only', () => {
  it('returns discovered tools without persisting anything', async () => {
    const res = await GET(
      new Request('http://localhost/api/harnesses/h_test/tools/discover'),
      makeParams('h_test')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.discoveredIds).toEqual(['tool-a', 'tool-b'])
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
  })

  it('?sync=true has NO side-effect — never writes via GET (issue #141)', async () => {
    const res = await GET(
      new Request('http://localhost/api/harnesses/h_test/tools/discover?sync=true'),
      makeParams('h_test')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
    expect(body.synced).toBe(false)
  })

  it('404s for a missing harness', async () => {
    vi.mocked(services.harness.get).mockReturnValue(undefined as never)
    const res = await GET(
      new Request('http://localhost/api/harnesses/nope/tools/discover'),
      makeParams('nope')
    )
    expect(res.status).toBe(404)
  })
})

describe('POST /api/harnesses/:id/tools/discover — gated sync', () => {
  it('persists discovered tools when the harness has none assigned', async () => {
    const res = await POST(
      new Request('http://localhost/api/harnesses/h_test/tools/discover', { method: 'POST' }),
      makeParams('h_test')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).toHaveBeenCalledWith('h_test', {
      tools: ['tool-a', 'tool-b'],
    })
    expect(body.synced).toBe(true)
    expect(body.discoveredIds).toEqual(['tool-a', 'tool-b'])
  })

  it('no-ops when tools were already explicitly assigned', async () => {
    vi.mocked(services.harness.get).mockReturnValue(
      makeHarness({ tools: ['existing-tool'] }) as never
    )
    const res = await POST(
      new Request('http://localhost/api/harnesses/h_test/tools/discover', { method: 'POST' }),
      makeParams('h_test')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
    expect(body.synced).toBe(false)
  })

  it('no-ops when discovery finds nothing', async () => {
    vi.mocked(services.tools.discoverForHarness).mockReturnValue([])
    const res = await POST(
      new Request('http://localhost/api/harnesses/h_test/tools/discover', { method: 'POST' }),
      makeParams('h_test')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
    expect(body.synced).toBe(false)
  })

  it('404s for a missing harness', async () => {
    vi.mocked(services.harness.get).mockReturnValue(undefined as never)
    const res = await POST(
      new Request('http://localhost/api/harnesses/nope/tools/discover', { method: 'POST' }),
      makeParams('nope')
    )
    expect(res.status).toBe(404)
    expect(services.harness.updateConfig).not.toHaveBeenCalled()
  })
})
