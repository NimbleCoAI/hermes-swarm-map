import { describe, it, expect, beforeEach, vi } from 'vitest'
import { markRestarting, isRestarting, clearRestarting } from '../restart-tracker'

describe('restart-tracker', () => {
  beforeEach(() => {
    // Clear any leftover state between tests
    clearRestarting('test-id')
    clearRestarting('expired-id')
  })

  it('markRestarting + isRestarting returns true', () => {
    markRestarting('test-id', 'rebuild')
    expect(isRestarting('test-id')).toBe(true)
  })

  it('clearRestarting + isRestarting returns false', () => {
    markRestarting('test-id', 'quick')
    clearRestarting('test-id')
    expect(isRestarting('test-id')).toBe(false)
  })

  it('isRestarting returns false for unknown id', () => {
    expect(isRestarting('unknown-id')).toBe(false)
  })

  it('TTL expiry causes isRestarting to return false', () => {
    markRestarting('expired-id', 'purge')

    // Fast-forward time past the 5-minute TTL
    const originalNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 5 * 60 * 1000 + 1)

    expect(isRestarting('expired-id')).toBe(false)

    vi.restoreAllMocks()
  })

  // Regression: #150 — a fast (quick/recreate) restart completes in seconds, but
  // the lock previously only cleared via a status GET or the 5-min TTL. A pure-API
  // iterate-restart-verify loop that never GETs status was then falsely 409'd for
  // the full 5 minutes. Fast modes now use a short TTL so back-to-back restarts
  // after the container has settled are not blocked.
  it('quick-mode lock clears after the short TTL, not the 5-min window', () => {
    markRestarting('test-id', 'quick')

    const originalNow = Date.now
    // 2 minutes later: well past a settled quick restart, still inside the old 5-min window
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 2 * 60 * 1000)

    expect(isRestarting('test-id')).toBe(false)

    vi.restoreAllMocks()
  })

  it('recreate-mode lock also uses the short TTL', () => {
    markRestarting('test-id', 'recreate')

    const originalNow = Date.now
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 2 * 60 * 1000)

    expect(isRestarting('test-id')).toBe(false)

    vi.restoreAllMocks()
  })

  it('quick-mode lock is still held immediately after a restart (short debounce)', () => {
    markRestarting('test-id', 'quick')

    const originalNow = Date.now
    // 30s later: a restart genuinely just fired — keep the lock so we do not
    // hammer the container mid-settle.
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 30 * 1000)

    expect(isRestarting('test-id')).toBe(true)

    vi.restoreAllMocks()
  })

  it('build-mode lock survives the short TTL window (long builds need the full 5 min)', () => {
    markRestarting('expired-id', 'rebuild')

    const originalNow = Date.now
    // 2 minutes in: a rebuild may still be compiling — must NOT be considered done.
    vi.spyOn(Date, 'now').mockReturnValue(originalNow() + 2 * 60 * 1000)

    expect(isRestarting('expired-id')).toBe(true)

    vi.restoreAllMocks()
  })
})
