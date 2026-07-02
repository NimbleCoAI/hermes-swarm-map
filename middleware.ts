import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session'

/**
 * Auth gate for mutating API routes.
 *
 * WHY: HSM has no transport auth. Docker Desktop SNATs container traffic to
 * 127.0.0.1, so agent-container requests and dashboard requests are
 * indistinguishable by source IP — the only viable separator is a credential
 * the agent cannot obtain. This gate requires a valid operator-session cookie
 * (a stateless HMAC of HSM_OPERATOR_TOKEN) on every state-changing request.
 *
 * BEHAVIOR:
 *  - GET / HEAD (and anything non-mutating, e.g. OPTIONS): always pass. Agents'
 *    is-admin / policy reads are GETs and must be unaffected; all dashboard
 *    reads are GETs too.
 *  - POST / PUT / PATCH / DELETE: require a valid hsm_session cookie, else 401.
 *  - /api/auth/login and /api/auth/logout are excluded (they establish/clear
 *    the session and do their own token check).
 *
 * FAIL-OPEN KILL-SWITCH: if HSM_OPERATOR_TOKEN is unset/empty the gate passes
 * everything through, identical to pre-auth behavior. Deploying this code is a
 * no-op until the token is set; unsetting the token instantly disables the gate.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Routes that must never be gated: they run before a session exists (login),
// tear it down (logout), and neither should 401 the operator out.
const EXCLUDED_PATHS = new Set(['/api/auth/login', '/api/auth/logout'])

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const method = request.method.toUpperCase()

  // Non-mutating requests are never gated.
  if (!MUTATING_METHODS.has(method)) {
    return NextResponse.next()
  }

  // Auth endpoints establish/clear the session; never gate them.
  if (EXCLUDED_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  const token = process.env.HSM_OPERATOR_TOKEN
  // Kill-switch: no token configured → gate disabled, pass everything.
  if (!token) {
    return NextResponse.next()
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value
  if (await verifySession(cookie, token)) {
    return NextResponse.next()
  }

  return NextResponse.json({ error: 'auth required' }, { status: 401 })
}

export const config = {
  matcher: '/api/:path*',
}
