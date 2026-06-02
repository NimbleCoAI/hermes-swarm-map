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
vi.mock('@/lib/services', () => ({
  services: {
    harness: { restart: restartMock },
  },
}))

import { POST } from './route'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

let readSpy: ReturnType<typeof vi.spyOn>
let writeSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
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
