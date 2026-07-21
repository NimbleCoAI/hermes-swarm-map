// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LettaService } from '../letta'

// Capture the URL/init each request hits so we can assert the exact REST paths —
// these are the confirmed memfs endpoints (docs.letta.com 2026-07-21), and the
// spike's blocks path was wrong (/blocks vs /core-memory/blocks).
function stubFetch(body: unknown, ok = true) {
  // Params are declared purely so fetchFn.mock.calls is typed [string, RequestInit?].
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok,
    status: ok ? 200 : 502,
    statusText: ok ? 'OK' : 'Bad Gateway',
    text: async () => JSON.stringify(body),
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('LettaService memfs read endpoints', () => {
  let letta: LettaService
  beforeEach(() => {
    letta = new LettaService('http://letta.test')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('getMemoryBlocks hits /core-memory/blocks (NOT the nonexistent /blocks)', async () => {
    const fetchFn = stubFetch([{ label: 'persona', value: 'p' }])
    const blocks = await letta.getMemoryBlocks('agent-1')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const url = fetchFn.mock.calls[0][0]
    expect(url).toBe('http://letta.test/v1/agents/agent-1/core-memory/blocks')
    expect(url).not.toContain('/agents/agent-1/blocks')
    expect(blocks[0].label).toBe('persona')
  })

  it('getMemoryBlocks URL-encodes the agent id', async () => {
    const fetchFn = stubFetch([])
    await letta.getMemoryBlocks('a b/c')
    expect(fetchFn.mock.calls[0][0]).toBe('http://letta.test/v1/agents/a%20b%2Fc/core-memory/blocks')
  })

  it('listFiles hits /files and passes is_open + limit query params', async () => {
    const fetchFn = stubFetch([{ file_name: 'system/persona.md', is_open: true }])
    await letta.listFiles('agent-1', { isOpen: true, limit: 50 })
    const url = fetchFn.mock.calls[0][0]
    expect(url).toContain('/v1/agents/agent-1/files?')
    expect(url).toContain('is_open=true')
    expect(url).toContain('limit=50')
  })

  it('listFiles with no opts hits a bare /files path', async () => {
    const fetchFn = stubFetch([])
    await letta.listFiles('agent-1')
    expect(fetchFn.mock.calls[0][0]).toBe('http://letta.test/v1/agents/agent-1/files')
  })

  it('surfaces a non-ok response as an error (route maps it to 502)', async () => {
    stubFetch({ detail: 'nope' }, false)
    await expect(letta.getMemoryBlocks('agent-1')).rejects.toThrow(/failed/i)
  })
})
