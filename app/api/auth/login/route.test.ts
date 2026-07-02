import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { POST } from './route'
import { SESSION_COOKIE, computeSessionValue } from '@/lib/auth/session'

const TOKEN = 'super-secret-operator-token'

function loginRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  delete process.env.HSM_OPERATOR_TOKEN
})

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    process.env.HSM_OPERATOR_TOKEN = TOKEN
  })

  it('valid token → sets the hsm_session cookie', async () => {
    const res = await POST(loginRequest({ token: TOKEN }))
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') || ''
    const expected = await computeSessionValue(TOKEN)
    expect(setCookie).toContain(`${SESSION_COOKIE}=${expected}`)
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    // http request → cookie must NOT be Secure (else browser drops it).
    expect(setCookie.toLowerCase()).not.toContain('secure')
  })

  it('wrong token → 401 and no cookie', async () => {
    const res = await POST(loginRequest({ token: 'nope' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it('marks the cookie Secure when served over https (x-forwarded-proto)', async () => {
    const req = new Request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-proto': 'https' },
      body: JSON.stringify({ token: TOKEN }),
    })
    const res = await POST(req)
    expect((res.headers.get('set-cookie') || '').toLowerCase()).toContain('secure')
  })
})

describe('POST /api/auth/login — token unset (kill-switch)', () => {
  it('returns ok with authDisabled and sets no cookie', async () => {
    const res = await POST(loginRequest({ token: 'anything' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.authDisabled).toBe(true)
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
