/**
 * Regression tests for the Surfaces-tab dialog wrappers and SurfaceConnectDialog.
 *
 * Confirms the wrappers still expose the same props and drive the real flow
 * (Signal happy path renders through phone→verify→done; pending mode reaches
 * the captured terminal without calling connect).
 *
 * jsdom doesn't implement <dialog>.showModal/close — stub them so the dialog
 * effect doesn't throw, then assert on rendered content.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { SignalSetupDialog } from './signal-setup-dialog'
import { SurfaceConnectDialog } from './surface-connect-dialog'

beforeEach(() => {
  // jsdom: <dialog> modal methods are not implemented
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    return { ok: true, json: async () => handler(url, init) } as Response
  }) as unknown as typeof fetch
}

describe('SignalSetupDialog wrapper (harness mode)', () => {
  it('exposes the original props and drives phone → verify → connect → done', async () => {
    mockFetch((url) => {
      if (url === '/api/surfaces/signal') return { healthy: true }
      if (url === '/api/surfaces/signal/register') return { success: true }
      if (url === '/api/surfaces/signal/verify') return { success: true }
      if (url.includes('/surfaces/connect')) return { success: true }
      return {}
    })

    const onConnected = vi.fn()
    render(
      <SignalSetupDialog
        open
        onClose={() => {}}
        harnessId="h_demo"
        harnessName="Demo"
        onConnected={onConnected}
      />
    )

    // Phone step (after health resolves to healthy)
    await waitFor(() => expect(screen.getByPlaceholderText('+15551234567')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15551234567' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register', hidden: true }))

    // Verify step
    await waitFor(() => expect(screen.getByPlaceholderText('123456')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify', hidden: true }))

    await waitFor(() => expect(screen.getByText('Signal connected!')).toBeTruthy())

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    const connectCall = fetchFn.mock.calls.find((c) =>
      String(c[0]).includes('/api/harnesses/h_demo/surfaces/connect')
    )
    expect(connectCall).toBeTruthy()
    expect(onConnected).toHaveBeenCalled()
  })
})

describe('SurfaceConnectDialog pending mode', () => {
  it('signal: reaches captured terminal, fires onCaptured, never calls connect', async () => {
    mockFetch((url) => {
      if (url === '/api/surfaces/signal') return { healthy: true }
      if (url === '/api/surfaces/signal/register') return { success: true }
      if (url === '/api/surfaces/signal/verify') return { success: true }
      if (url.includes('/surfaces/connect')) throw new Error('connect must not run in pending')
      return {}
    })

    const onCaptured = vi.fn()
    render(
      <SurfaceConnectDialog
        platform="signal"
        target={{ kind: 'pending' }}
        open
        onClose={() => {}}
        onCaptured={onCaptured}
      />
    )

    await waitFor(() => expect(screen.getByPlaceholderText('+15551234567')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('+15551234567'), {
      target: { value: '+15550001111' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Register', hidden: true }))

    await waitFor(() => expect(screen.getByPlaceholderText('123456')).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify', hidden: true }))

    await waitFor(() => expect(screen.getByText('Signal ready')).toBeTruthy())

    const fetchFn = global.fetch as ReturnType<typeof vi.fn>
    expect(
      fetchFn.mock.calls.find((c) => String(c[0]).includes('/surfaces/connect'))
    ).toBeUndefined()
    expect(onCaptured).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+15550001111' })
    )
  })
})
