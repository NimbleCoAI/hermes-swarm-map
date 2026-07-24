// @vitest-environment node
/**
 * Tests for expandSignalAllowlist, resolveTelegramAdmins, expandTelegramAllowlist.
 *
 * Sealed-sender Signal DMs identify the sender only by UUID, never phone number.
 * The gateway compares that inbound UUID against SIGNAL_ALLOWED_USERS verbatim,
 * so a phone-number-only allowlist silently rejects the very person it names.
 * expandSignalAllowlist resolves each phone to its UUID and stores BOTH forms.
 *
 * Telegram has the analogous failure: the gateway matches numeric sender IDs
 * against TELEGRAM_ALLOWED_USERS verbatim, so a raw @username never matches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./signal', () => ({
  resolveSignalPhone: vi.fn(),
  getSignalAccountUuid: vi.fn(),
}))
vi.mock('./telegram', () => ({
  resolveTelegramUsername: vi.fn(),
  getTelegramDisplayName: vi.fn(),
}))

import { expandSignalAllowlist, resolveTelegramAdmins, expandTelegramAllowlist } from './index'
import { resolveSignalPhone } from './signal'
import { resolveTelegramUsername } from './telegram'

const mockResolve = vi.mocked(resolveSignalPhone)
const mockTgResolve = vi.mocked(resolveTelegramUsername)

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

describe('resolveTelegramAdmins (strict — connect path)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes numeric IDs through without resolving', async () => {
    const result = await resolveTelegramAdmins('h_x', ['123456789', '-1001234'])
    expect(result).toEqual({
      ok: true,
      ids: ['123456789', '-1001234'],
      resolved: [
        { display: '123456789', nativeId: '123456789' },
        { display: '-1001234', nativeId: '-1001234' },
      ],
    })
    expect(mockTgResolve).not.toHaveBeenCalled()
  })

  it('resolves @usernames to numeric IDs, passing the explicit bot token through', async () => {
    mockTgResolve.mockResolvedValue({ display: '@juniper', nativeId: '424242', profileName: 'Juniper' })
    const result = await resolveTelegramAdmins('h_x', ['111', ' @juniper '], 'tok:abc')
    expect(result).toEqual({
      ok: true,
      ids: ['111', '424242'],
      resolved: [
        { display: '111', nativeId: '111' },
        { display: '@juniper', nativeId: '424242', profileName: 'Juniper' },
      ],
    })
    expect(mockTgResolve).toHaveBeenCalledWith('h_x', '@juniper', 'tok:abc')
  })

  it('fails (never stores the raw handle) when a handle does not resolve', async () => {
    mockTgResolve.mockResolvedValue(null)
    const result = await resolveTelegramAdmins('h_x', ['@ghost'], 'tok:abc')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('@ghost')
  })

  it('rejects the wildcard as an admin entry', async () => {
    const result = await resolveTelegramAdmins('h_x', ['*'])
    expect(result.ok).toBe(false)
  })

  it('dedupes entries that resolve to the same numeric ID and skips blanks', async () => {
    mockTgResolve.mockResolvedValue({ display: '@dup', nativeId: '999' })
    const result = await resolveTelegramAdmins('h_x', ['999', '@dup', '', ' '])
    expect(result).toMatchObject({ ok: true, ids: ['999'] })
  })
})

describe('expandTelegramAllowlist (best-effort — settings path)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('expands an @username entry to include its resolved numeric ID', async () => {
    mockTgResolve.mockResolvedValue({ display: '@juniper', nativeId: '424242' })
    expect(await expandTelegramAllowlist('h_x', ['@juniper'])).toEqual(['@juniper', '424242'])
  })

  it('passes numeric IDs and the "*" wildcard through without resolving', async () => {
    expect(await expandTelegramAllowlist('h_x', ['123', '*', '-100999'])).toEqual(['123', '*', '-100999'])
    expect(mockTgResolve).not.toHaveBeenCalled()
  })

  it('keeps the handle unchanged when resolution fails (no worse than before)', async () => {
    mockTgResolve.mockResolvedValue(null)
    expect(await expandTelegramAllowlist('h_x', ['@ghost'])).toEqual(['@ghost'])
  })

  it('does not duplicate an ID already present in the list', async () => {
    mockTgResolve.mockResolvedValue({ display: '@juniper', nativeId: '424242' })
    expect(await expandTelegramAllowlist('h_x', ['@juniper', '424242'])).toEqual(['@juniper', '424242'])
  })
})
