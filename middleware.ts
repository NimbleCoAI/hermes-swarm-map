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
 *  - POST / PUT / PATCH / DELETE: require a valid hsm_session cookie.
 *  - GET / HEAD: require the session too — UNLESS the path is one of the few an
 *    agent legitimately reads at runtime (AGENT_READABLE_GET_PATHS). Many reads
 *    leak operator-sensitive data (keys roster, settings PII, people, admin
 *    rosters, decrypted PIN, audit trail), so reads are gated by default and the
 *    agent-read paths are an explicit allowlist. Agents get their policy/
 *    allowlist from env_file at boot; the only runtime HTTP reads they make are
 *    the per-user is-admin / is-group-allowed booleans below (they carry no
 *    secrets). Dashboard reads ride the same-origin cookie once logged in.
 *  - /api/auth/login and /api/auth/logout are excluded (establish/clear session).
 *
 * FAIL CLOSED: if HSM_OPERATOR_TOKEN is unset/empty, gated requests are REFUSED
 * with 503 rather than served open — a missing operator secret must never
 * degrade to no-auth. The agent-read allowlist still passes (booleans, no
 * secrets) so the fleet keeps working while auth is (mis)configured.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const READ_METHODS = new Set(['GET', 'HEAD'])

// Routes that must never be gated: they run before a session exists (login),
// tear it down (logout), and neither should 401 the operator out.
const EXCLUDED_PATHS = new Set(['/api/auth/login', '/api/auth/logout'])

// The ONLY GET paths agents read at runtime (verified against hermes-agent
// swarm_map_policy plugin). Each returns a boolean, no secret. `admins/<userId>`
// is the per-user is-admin check — distinct from the bare `admins` roster, which
// IS gated. `policy` is allowlisted defensively for older agent builds.
const AGENT_READABLE_GET_PATHS: RegExp[] = [
  /^\/api\/harnesses\/[^/]+\/surfaces\/[^/]+\/groups\/[^/]+$/,  // is_group_allowed
  /^\/api\/harnesses\/[^/]+\/surfaces\/[^/]+\/admins\/[^/]+$/,  // is_platform_admin (per-user)
  /^\/api\/harnesses\/[^/]+\/policy$/,                          // agent .env policy read
]

function requiresAuth(method: string, pathname: string): boolean {
  if (MUTATING_METHODS.has(method)) return true
  if (READ_METHODS.has(method)) {
    return !AGENT_READABLE_GET_PATHS.some((re) => re.test(pathname))
  }
  return false // OPTIONS and other non-mutating verbs
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const method = request.method.toUpperCase()
  const pathname = request.nextUrl.pathname

  // Auth endpoints establish/clear the session; never gate them.
  if (EXCLUDED_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  // Ordinary reads (agents' policy/is-admin reads, dashboard reads) pass ungated.
  if (!requiresAuth(method, pathname)) {
    return NextResponse.next()
  }

  const token = process.env.HSM_OPERATOR_TOKEN
  // FAIL CLOSED: no operator secret configured → refuse rather than serve open.
  if (!token) {
    return NextResponse.json({ error: 'auth not configured' }, { status: 503 })
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
