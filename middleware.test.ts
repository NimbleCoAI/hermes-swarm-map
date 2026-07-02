import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'
import { SESSION_COOKIE, computeSessionValue } from '@/lib/auth/session'

const TOKEN = 'super-secret-operator-token'

function req(
  path: string,
  method: string,
  cookie?: string,
): NextRequest {
  const headers = new Headers()
  if (cookie) headers.set('cookie', `${SESSION_COOKIE}=${cookie}`)
  return new NextRequest(new URL(`http://localhost:3000${path}`), {
    method,
    headers,
  })
}

/** NextResponse.next() carries the x-middleware-next marker; a 401 block does not. */
function passedThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1'
}

describe('middleware auth gate — token SET', () => {
  beforeEach(() => {
    process.env.HSM_OPERATOR_TOKEN = TOKEN
  })
  afterEach(() => {
    delete process.env.HSM_OPERATOR_TOKEN
  })

  it('GET with no cookie → passes', async () => {
    const res = await middleware(req('/api/harnesses', 'GET'))
    expect(passedThrough(res)).toBe(true)
  })

  it('HEAD with no cookie → passes', async () => {
    const res = await middleware(req('/api/harnesses', 'HEAD'))
    expect(passedThrough(res)).toBe(true)
  })

  it('POST with no cookie → 401', async () => {
    const res = await middleware(req('/api/harnesses/create', 'POST'))
    expect(res.status).toBe(401)
    expect(passedThrough(res)).toBe(false)
    expect((await res.json()).error).toBe('auth required')
  })

  it('POST with an invalid/tampered cookie → 401', async () => {
    const good = await computeSessionValue(TOKEN)
    const tampered = (good[0] === 'a' ? 'b' : 'a') + good.slice(1)
    const res = await middleware(req('/api/harnesses/create', 'POST', tampered))
    expect(res.status).toBe(401)
  })

  it('POST with a valid cookie → passes', async () => {
    const good = await computeSessionValue(TOKEN)
    const res = await middleware(req('/api/harnesses/create', 'POST', good))
    expect(passedThrough(res)).toBe(true)
  })

  it('POST tools/discover with no cookie → 401 (sync side-effect stays gated, issue #141)', async () => {
    const res = await middleware(req('/api/harnesses/h_1/tools/discover', 'POST'))
    expect(res.status).toBe(401)
    expect(passedThrough(res)).toBe(false)
  })

  it('PUT / PATCH / DELETE with no cookie → 401', async () => {
    for (const m of ['PUT', 'PATCH', 'DELETE']) {
      const res = await middleware(req('/api/settings', m))
      expect(res.status).toBe(401)
    }
  })

  it('excludes /api/auth/login and /api/auth/logout from the gate', async () => {
    expect(passedThrough(await middleware(req('/api/auth/login', 'POST')))).toBe(true)
    expect(passedThrough(await middleware(req('/api/auth/logout', 'POST')))).toBe(true)
  })
})

describe('middleware auth gate — token UNSET (fail-open kill-switch)', () => {
  beforeEach(() => {
    delete process.env.HSM_OPERATOR_TOKEN
  })

  it('POST with no cookie → passes (gate disabled)', async () => {
    const res = await middleware(req('/api/harnesses/create', 'POST'))
    expect(passedThrough(res)).toBe(true)
  })

  it('DELETE with no cookie → passes (gate disabled)', async () => {
    const res = await middleware(req('/api/keys/k_1', 'DELETE'))
    expect(passedThrough(res)).toBe(true)
  })
})
