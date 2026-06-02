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
})
