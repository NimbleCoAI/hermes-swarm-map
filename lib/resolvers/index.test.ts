// @vitest-environment node
/**
 * Tests for expandSignalAllowlist.
 *
 * Sealed-sender Signal DMs identify the sender only by UUID, never phone number.
 * The gateway compares that inbound UUID against SIGNAL_ALLOWED_USERS verbatim,
 * so a phone-number-only allowlist silently rejects the very person it names.
 * expandSignalAllowlist resolves each phone to its UUID and stores BOTH forms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./signal', () => ({
  resolveSignalPhone: vi.fn(),
  getSignalAccountUuid: vi.fn(),
}))

import { expandSignalAllowlist } from './index'
import { resolveSignalPhone } from './signal'

const mockResolve = vi.mocked(resolveSignalPhone)

describe('expandSignalAllowlist', () => {
  beforeEach(() => vi.clearAllMocks())

  it('expands a phone-number entry to include its resolved UUID', async () => {
    mockResolve.mockResolvedValue({
      display: '+15550001234',
      nativeId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    })

    const result = await expandSignalAllowlist('h_nimbleco', ['+15550001234'])

    expect(result).toEqual([
      '+15550001234',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ])
  })

  it('passes a UUID entry through without resolving', async () => {
    const result = await expandSignalAllowlist('h_nimbleco', [
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ])

    expect(result).toEqual(['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'])
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('passes the "*" wildcard through untouched', async () => {
    const result = await expandSignalAllowlist('h_nimbleco', ['*'])

    expect(result).toEqual(['*'])
    expect(mockResolve).not.toHaveBeenCalled()
  })

  it('keeps the phone number when resolution fails', async () => {
    mockResolve.mockResolvedValue(null)

    const result = await expandSignalAllowlist('h_nimbleco', ['+15550001234'])

    expect(result).toEqual(['+15550001234'])
  })

  it('does not duplicate a UUID already present in the list', async () => {
    mockResolve.mockResolvedValue({
      display: '+15550001234',
      nativeId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    })

    const result = await expandSignalAllowlist('h_nimbleco', [
      '+15550001234',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ])

    expect(result).toEqual([
      '+15550001234',
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    ])
  })
})
