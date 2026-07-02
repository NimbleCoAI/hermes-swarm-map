import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth/session'

/**
 * POST /api/auth/logout — clears the operator-session cookie.
 * Excluded from the middleware gate.
 */
export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
