/**
 * Tests for POST /api/harnesses/:id/surfaces/disconnect
 *
 * Disconnecting a surface strips its vars from the agent .env, but the running
 * container keeps the stale env (and the live connection) until recreated.
 * Disconnect must recreate the container so the surface actually goes away.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'

const restartMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services', () => ({
  services: {
    harness: { restart: restartMock },
  },
}))

import { POST } from './route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
  vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  vi.spyOn(fs, 'readFileSync').mockReturnValue('TELEGRAM_BOT_TOKEN=tok\nTELEGRAM_ALLOWED_USERS=1\n')
  vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('surface disconnect — applies removal by recreating the container', () => {
  it('recreates the container after stripping the telegram env', async () => {
    const req = new Request('http://localhost/api/harnesses/h_seraph/surfaces/disconnect', {
      method: 'POST',
      body: JSON.stringify({ platform: 'telegram' }),
    })

    const res = await POST(req, makeParams('h_seraph'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(restartMock).toHaveBeenCalledWith('h_seraph', 'recreate')
  })

  it('recreates the container after stripping the discord env', async () => {
    const req = new Request('http://localhost/api/harnesses/h_seraph/surfaces/disconnect', {
      method: 'POST',
      body: JSON.stringify({ platform: 'discord' }),
    })

    const res = await POST(req, makeParams('h_seraph'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(restartMock).toHaveBeenCalledWith('h_seraph', 'recreate')
  })

  it('recreates the container after stripping the slack env', async () => {
    const req = new Request('http://localhost/api/harnesses/h_seraph/surfaces/disconnect', {
      method: 'POST',
      body: JSON.stringify({ platform: 'slack' }),
    })

    const res = await POST(req, makeParams('h_seraph'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(restartMock).toHaveBeenCalledWith('h_seraph', 'recreate')
  })
})

describe('surface disconnect — disables the platform in config.yaml', () => {
  // The gateway starts every platform with `platforms.<p>.enabled: true` —
  // disconnect must flip the flag or the surface comes back on next boot.

  function disconnect(platform: string) {
    return POST(
      new Request('http://localhost/api/harnesses/h_seraph/surfaces/disconnect', {
        method: 'POST',
        body: JSON.stringify({ platform }),
      }),
      makeParams('h_seraph')
    )
  }

  function configWrite() {
    return vi.mocked(fs.writeFileSync).mock.calls.find(c => String(c[0]).endsWith('config.yaml'))
  }

  it('sets enabled: false without deleting sibling keys', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('config.yaml')) {
        return 'platforms:\n  discord:\n    enabled: true\n    intents: default\n  telegram:\n    enabled: true\n'
      }
      return 'DISCORD_BOT_TOKEN=tok\n'
    })

    const res = await disconnect('discord')
    expect(res.status).toBe(200)

    const written = configWrite()?.[1] as string
    expect(written).toContain('  discord:\n    enabled: false\n    intents: default')
    // Other platforms untouched.
    expect(written).toContain('  telegram:\n    enabled: true')
  })

  it('is a no-op when the platform entry is missing (no config write)', async () => {
    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (String(p).endsWith('config.yaml')) {
        return 'platforms:\n  telegram:\n    enabled: true\n'
      }
      return 'DISCORD_BOT_TOKEN=tok\n'
    })

    const res = await disconnect('discord')
    expect(res.status).toBe(200)
    expect(configWrite()).toBeUndefined()
  })

  it('skips gracefully when config.yaml does not exist', async () => {
    vi.mocked(fs.existsSync).mockImplementation((p) => !String(p).endsWith('config.yaml'))

    const res = await disconnect('discord')
    expect(res.status).toBe(200)
    expect(configWrite()).toBeUndefined()
  })
})
