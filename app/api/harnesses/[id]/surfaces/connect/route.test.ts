/**
 * Tests for POST /api/harnesses/:id/surfaces/connect
 *
 * Regression: connecting/editing a surface writes the agent .env but the
 * running container kept the OLD environment until a manual force-recreate.
 * A `connect` must recreate the container so the new env actually takes effect.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'

// Mock the services module — we assert harness.restart is invoked.
const restartMock = vi.hoisted(() => vi.fn())
const syncFromAllowlistMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services', () => ({
  services: {
    harness: { restart: restartMock },
    surfaceAdmins: { syncFromAllowlist: syncFromAllowlistMock },
  },
}))
// Use the real resolvers index (so resolveTelegramAdmins' strict logic is
// exercised through the route) but stub the per-platform network resolvers.
vi.mock('@/lib/resolvers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resolvers')>()),
  expandSignalAllowlist: vi.fn(async () => [
    '+15550001234',
    'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  ]),
}))
const resolveTelegramUsernameMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/resolvers/telegram', () => ({
  resolveTelegramUsername: resolveTelegramUsernameMock,
  getTelegramDisplayName: vi.fn(async () => null),
}))

import { POST } from './route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

let readSpy: ReturnType<typeof vi.spyOn>
let writeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // vi.restoreAllMocks() only restores spies — hoisted vi.fn() mocks keep their
  // call history across tests unless cleared here.
  restartMock.mockClear()
  syncFromAllowlistMock.mockClear()
  resolveTelegramUsernameMock.mockClear()
  vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  readSpy = vi.spyOn(fs, 'readFileSync')
  readSpy.mockReturnValue('TELEGRAM_BOT_TOKEN=old\n')
  writeSpy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('surface connect — applies env by recreating the container', () => {
  it('recreates the container after writing the new telegram env', async () => {
    const req = new Request('http://localhost/api/harnesses/h_seraph/surfaces/connect', {
      method: 'POST',
      body: JSON.stringify({ platform: 'telegram', config: { token: 'new-bot-token' } }),
    })

    const res = await POST(req, makeParams('h_seraph'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    // The env was written...
    expect(writeSpy).toHaveBeenCalled()
    // ...and the container recreated so the env takes effect (no rebuild needed).
    expect(restartMock).toHaveBeenCalledWith('h_seraph', 'recreate')
  })

  it('writes both the phone and its resolved UUID into SIGNAL_ALLOWED_USERS', async () => {
    readSpy.mockReturnValue('SIGNAL_ACCOUNT=+16189263363\n')
    // Signal connect runs a pre-flight daemon health check via fetch.
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ result: [] }) })))

    const req = new Request('http://localhost/api/harnesses/h_nimbleco/surfaces/connect', {
      method: 'POST',
      body: JSON.stringify({
        platform: 'signal',
        config: { phone: '+16189263363', adminUser: '+15550001234' },
      }),
    })

    const res = await POST(req, makeParams('h_nimbleco'))
    expect(res.status).toBe(200)

    const written = writeSpy.mock.calls.at(-1)?.[1] as string
    expect(written).toContain(
      'SIGNAL_ALLOWED_USERS=+15550001234,aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    )
    vi.unstubAllGlobals()
  })

  it('resolves telegram @handles to numeric IDs and normalizes multiple admins', async () => {
    resolveTelegramUsernameMock.mockResolvedValue({
      display: '@juniper',
      nativeId: '424242',
      profileName: 'Juniper',
    })

    const req = new Request('http://localhost/api/harnesses/h_seraph/surfaces/connect', {
      method: 'POST',
      body: JSON.stringify({
        platform: 'telegram',
        config: { token: 'new-bot-token', adminUser: '123456789, @juniper' },
      }),
    })

    const res = await POST(req, makeParams('h_seraph'))
    expect(res.status).toBe(200)

    // The token from the request payload is used (the .env may not have it yet).
    expect(resolveTelegramUsernameMock).toHaveBeenCalledWith('h_seraph', '@juniper', 'new-bot-token')

    // Numeric IDs only in the env — never a raw @handle.
    const envCall = writeSpy.mock.calls.find(c => String(c[0]).endsWith('.env'))
    expect(envCall?.[1]).toContain('TELEGRAM_ALLOWED_USERS=123456789,424242')

    // Display names persisted the same way the settings path does.
    const resolvedCall = writeSpy.mock.calls.find(c => String(c[0]).endsWith('resolved-identities.json'))
    expect(resolvedCall).toBeTruthy()
    expect(JSON.parse(resolvedCall![1] as string).telegram).toEqual([
      { display: '123456789', nativeId: '123456789' },
      { display: '@juniper', nativeId: '424242', profileName: 'Juniper' },
    ])

    // Policy-plane overlay kept converged with the allowlist just written.
    expect(syncFromAllowlistMock).toHaveBeenCalledWith('h_seraph', 'telegram', ['123456789', '424242'])
  })

  it('returns 400 (and writes nothing) when a telegram @handle fails to resolve', async () => {
    resolveTelegramUsernameMock.mockResolvedValue(null)

    const req = new Request('http://localhost/api/harnesses/h_seraph/surfaces/connect', {
      method: 'POST',
      body: JSON.stringify({
        platform: 'telegram',
        config: { token: 'new-bot-token', adminUser: '@ghosthandle' },
      }),
    })

    const res = await POST(req, makeParams('h_seraph'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('@ghosthandle')
    expect(writeSpy).not.toHaveBeenCalled()
    expect(restartMock).not.toHaveBeenCalled()
  })

  it('still succeeds (does not 500) when recreate fails', async () => {
    restartMock.mockImplementationOnce(() => { throw new Error('no compose file') })

    const req = new Request('http://localhost/api/harnesses/h_seraph/surfaces/connect', {
      method: 'POST',
      body: JSON.stringify({ platform: 'telegram', config: { token: 'new-bot-token' } }),
    })

    const res = await POST(req, makeParams('h_seraph'))
    expect(res.status).toBe(200)
  })
})
