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
})
