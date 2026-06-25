/**
 * Tests for useSurfaceRegister — the shared surface register/connect flow hook.
 *
 * Pins the existing Surfaces-tab behavior (harness mode) and the new wizard
 * (pending mode) where connect is NOT called and config is captured instead.
 *
 * All /api/* and Telegram fetches are mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSurfaceRegister } from './useSurfaceRegister'

type FetchHandler = (url: string, init?: RequestInit) => unknown

function mockFetch(handler: FetchHandler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const data = handler(url, init)
    return {
      ok: true,
      json: async () => data,
    } as Response
  })
  global.fetch = fn as unknown as typeof fetch
  return fn
}

function bodyOf(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit
  return JSON.parse(init.body as string)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useSurfaceRegister — signal, harness mode', () => {
  beforeEach(() => {
    mockFetch((url) => {
      if (url === '/api/surfaces/signal') return { healthy: true }
      if (url === '/api/surfaces/signal/register') return { success: true }
      if (url === '/api/surfaces/signal/verify') return { success: true }
      if (url.includes('/surfaces/connect')) return { success: true }
      return {}
    })
  })

  it('runs health → register → verify → connect with the correct connect body', async () => {
    const onConnected = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'signal',
        target: { kind: 'harness', harnessId: 'h_test' },
        onConnected,
      })
    )

    // health check happens on init
    await act(async () => { await result.current.checkHealth() })
    expect(result.current.daemonHealthy).toBe(true)

    act(() => {
      result.current.setPhone('+15551234567')
      result.current.setDisplayName('Test Bot')
    })

    await act(async () => { await result.current.register() })
    expect(result.current.step).toBe('verify')

    act(() => { result.current.setVerifyCode('123456') })
    await act(async () => { await result.current.verify() })

    await waitFor(() => expect(result.current.step).toBe('done'))

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const connectCall = fetchFn.mock.calls.find((c) =>
      String(c[0]).includes('/api/harnesses/h_test/surfaces/connect')
    )
    expect(connectCall).toBeTruthy()
    const body = bodyOf(connectCall!)
    expect(body.platform).toBe('signal')
    expect(body.config).toMatchObject({
      phone: '+15551234567',
      url: 'http://host.docker.internal:8080',
      profileName: 'Test Bot',
    })
    expect(onConnected).toHaveBeenCalled()
  })

  it('routes to captcha step when register returns needsCaptcha', async () => {
    mockFetch((url) => {
      if (url === '/api/surfaces/signal') return { healthy: true }
      if (url === '/api/surfaces/signal/register') return { needsCaptcha: true }
      return {}
    })
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'signal',
        target: { kind: 'harness', harnessId: 'h_test' },
        onConnected: vi.fn(),
      })
    )
    act(() => { result.current.setPhone('+15551234567') })
    await act(async () => { await result.current.register() })
    expect(result.current.step).toBe('captcha')
  })

  it('verify posts code, displayName, pin and harnessId', async () => {
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'signal',
        target: { kind: 'harness', harnessId: 'h_test' },
        onConnected: vi.fn(),
      })
    )
    act(() => {
      result.current.setPhone('+15551234567')
      result.current.setVerifyCode('654321')
      result.current.setDisplayName('Bot')
    })
    await act(async () => { await result.current.verify() })

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const verifyCall = fetchFn.mock.calls.find((c) =>
      String(c[0]) === '/api/surfaces/signal/verify'
    )
    const body = bodyOf(verifyCall!)
    expect(body).toMatchObject({
      phone: '+15551234567',
      code: '654321',
      displayName: 'Bot',
      harnessId: 'h_test',
    })
    expect(typeof body.pin).toBe('string')
  })
})

describe('useSurfaceRegister — signal, pending (wizard) mode', () => {
  beforeEach(() => {
    mockFetch((url) => {
      if (url === '/api/surfaces/signal') return { healthy: true }
      if (url === '/api/surfaces/signal/register') return { success: true }
      if (url === '/api/surfaces/signal/verify') return { success: true }
      if (url.includes('/surfaces/connect')) {
        throw new Error('connect must NOT be called in pending mode')
      }
      return {}
    })
  })

  it('captures config and reaches captured step without calling connect', async () => {
    const onCaptured = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'signal',
        target: { kind: 'pending' },
        onCaptured,
      })
    )
    act(() => {
      result.current.setPhone('+15559998888')
      result.current.setDisplayName('Wizard Bot')
    })
    await act(async () => { await result.current.register() })
    expect(result.current.step).toBe('verify')

    act(() => { result.current.setVerifyCode('111222') })
    await act(async () => { await result.current.verify() })

    await waitFor(() => expect(result.current.step).toBe('captured'))

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const connectCall = fetchFn.mock.calls.find((c) =>
      String(c[0]).includes('/surfaces/connect')
    )
    expect(connectCall).toBeUndefined()

    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+15559998888',
        url: 'http://host.docker.internal:8080',
        profileName: 'Wizard Bot',
      })
    )
  })
})

describe('useSurfaceRegister — telegram', () => {
  it('harness mode: getMe then connect with token', async () => {
    mockFetch((url) => {
      if (url.includes('api.telegram.org')) return { ok: true, result: { username: 'mybot' } }
      if (url.includes('/surfaces/connect')) return { success: true }
      return {}
    })
    const onConnected = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'telegram',
        target: { kind: 'harness', harnessId: 'h_tg' },
        onConnected,
      })
    )
    act(() => { result.current.setToken('123456:ABCdef') })
    await act(async () => { await result.current.verify() })
    expect(result.current.step).toBe('verified')

    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.step).toBe('done'))

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const connectCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/surfaces/connect'))
    const body = bodyOf(connectCall!)
    expect(body.platform).toBe('telegram')
    expect(body.config).toMatchObject({ token: '123456:ABCdef' })
    expect(onConnected).toHaveBeenCalled()
  })

  it('pending mode: getMe verifies then captures { token } without connect', async () => {
    mockFetch((url) => {
      if (url.includes('api.telegram.org')) return { ok: true, result: { username: 'mybot' } }
      if (url.includes('/surfaces/connect')) throw new Error('no connect in pending')
      return {}
    })
    const onCaptured = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'telegram',
        target: { kind: 'pending' },
        onCaptured,
      })
    )
    act(() => { result.current.setToken('999:XYZ') })
    await act(async () => { await result.current.verify() })
    await act(async () => { await result.current.connect() })

    await waitFor(() => expect(result.current.step).toBe('captured'))
    expect(onCaptured).toHaveBeenCalledWith(expect.objectContaining({ token: '999:XYZ' }))
  })
})

describe('useSurfaceRegister — mattermost', () => {
  it('harness mode: verify then connect with url+token', async () => {
    mockFetch((url) => {
      if (url === '/api/surfaces/mattermost/verify') return { valid: true, username: 'mmbot' }
      if (url.includes('/surfaces/connect')) return { success: true }
      return {}
    })
    const onConnected = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'mattermost',
        target: { kind: 'harness', harnessId: 'h_mm' },
        onConnected,
      })
    )
    act(() => {
      result.current.setUrl('https://mm.example.com')
      result.current.setToken('mmtoken')
    })
    await act(async () => { await result.current.verify() })
    expect(result.current.step).toBe('verified')
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.step).toBe('done'))

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const connectCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/surfaces/connect'))
    const body = bodyOf(connectCall!)
    expect(body.platform).toBe('mattermost')
    expect(body.config).toMatchObject({ url: 'https://mm.example.com', token: 'mmtoken' })
    expect(onConnected).toHaveBeenCalled()
  })

  it('pending mode: captures { url, token } without connect', async () => {
    mockFetch((url) => {
      if (url === '/api/surfaces/mattermost/verify') return { valid: true, username: 'mmbot' }
      if (url.includes('/surfaces/connect')) throw new Error('no connect in pending')
      return {}
    })
    const onCaptured = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'mattermost',
        target: { kind: 'pending' },
        onCaptured,
      })
    )
    act(() => {
      result.current.setUrl('https://mm.example.com')
      result.current.setToken('mmtoken')
    })
    await act(async () => { await result.current.verify() })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.step).toBe('captured'))
    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://mm.example.com', token: 'mmtoken' })
    )
  })
})

describe('useSurfaceRegister — discord', () => {
  it('harness mode: verify then connect with a bot token only', async () => {
    mockFetch((url) => {
      if (url === '/api/surfaces/discord/verify') return { valid: true, username: 'discordbot' }
      if (url.includes('/surfaces/connect')) return { success: true }
      return {}
    })
    const onConnected = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'discord',
        target: { kind: 'harness', harnessId: 'h_dc' },
        onConnected,
      })
    )
    act(() => {
      result.current.setToken('discord.bot.token')
    })
    await act(async () => { await result.current.verify() })
    expect(result.current.step).toBe('verified')
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.step).toBe('done'))

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const connectCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/surfaces/connect'))
    const body = bodyOf(connectCall!)
    expect(body.platform).toBe('discord')
    expect(body.config).toMatchObject({ token: 'discord.bot.token' })
    // Discord is token-only — no URL in the captured config.
    expect(body.config).not.toHaveProperty('url')
    expect(onConnected).toHaveBeenCalled()
  })

  it('pending mode: captures { token } without connect', async () => {
    mockFetch((url) => {
      if (url === '/api/surfaces/discord/verify') return { valid: true, username: 'discordbot' }
      if (url.includes('/surfaces/connect')) throw new Error('no connect in pending')
      return {}
    })
    const onCaptured = vi.fn()
    const { result } = renderHook(() =>
      useSurfaceRegister({
        platform: 'discord',
        target: { kind: 'pending' },
        onCaptured,
      })
    )
    act(() => {
      result.current.setToken('discord.bot.token')
    })
    await act(async () => { await result.current.verify() })
    await act(async () => { await result.current.connect() })
    await waitFor(() => expect(result.current.step).toBe('captured'))
    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'discord.bot.token' })
    )
  })
})
