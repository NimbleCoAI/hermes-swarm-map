import { NextResponse } from 'next/server'
import { SESSION_COOKIE, computeSessionValue, verifyToken } from '@/lib/auth/session'

/**
 * POST /api/auth/login
 * Body: { token: string }
 *
 * Verifies the operator token (constant-time) and, on success, sets the
 * stateless httpOnly hsm_session cookie. Excluded from the middleware gate.
 *
 * If HSM_OPERATOR_TOKEN is unset the gate is disabled, so there is nothing to
 * log into — respond ok with authDisabled so the login page can just proceed.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const token = process.env.HSM_OPERATOR_TOKEN
  if (!token) {
    return NextResponse.json({ ok: true, authDisabled: true })
  }

  let provided = ''
  try {
    const body = await request.json()
    if (typeof body?.token === 'string') provided = body.token
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  if (!(await verifyToken(provided, token))) {
    return NextResponse.json({ error: 'invalid token' }, { status: 401 })
  }

  // HSM is http on the trusted plane; only mark Secure when actually served over
  // https, otherwise the browser drops the cookie and login silently fails.
  const isHttps =
    new URL(request.url).protocol === 'https:' ||
    request.headers.get('x-forwarded-proto') === 'https'

  const value = await computeSessionValue(token)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: isHttps,
  })
  return response
}
