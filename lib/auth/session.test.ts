import { describe, it, expect } from 'vitest'
import {
  SESSION_MESSAGE,
  computeSessionValue,
  hmacHex,
  timingSafeEqual,
  verifyToken,
  verifySession,
} from './session'

describe('session primitives', () => {
  it('computeSessionValue is deterministic and 64-char hex', async () => {
    const a = await computeSessionValue('secret-token')
    const b = await computeSessionValue('secret-token')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('different tokens produce different session values', async () => {
    const a = await computeSessionValue('token-a')
    const b = await computeSessionValue('token-b')
    expect(a).not.toBe(b)
  })

  it('hmacHex matches computeSessionValue for the fixed message', async () => {
    expect(await hmacHex('k', SESSION_MESSAGE)).toBe(await computeSessionValue('k'))
  })

  it('timingSafeEqual: true for equal, false for differing or length-mismatched', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'abcd')).toBe(false)
  })

  it('verifyToken accepts the correct token and rejects a wrong one', async () => {
    expect(await verifyToken('correct', 'correct')).toBe(true)
    expect(await verifyToken('wrong', 'correct')).toBe(false)
  })

  it('verifySession accepts a valid cookie and rejects a tampered one', async () => {
    const token = 'operator-token'
    const good = await computeSessionValue(token)
    expect(await verifySession(good, token)).toBe(true)

    // Flip one hex char → tampered cookie must be rejected.
    const tampered = (good[0] === 'a' ? 'b' : 'a') + good.slice(1)
    expect(await verifySession(tampered, token)).toBe(false)

    // Missing cookie → rejected.
    expect(await verifySession(undefined, token)).toBe(false)
    expect(await verifySession('', token)).toBe(false)
  })
})
