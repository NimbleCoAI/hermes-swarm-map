// @vitest-environment node
/**
 * Tests for PUT /api/harnesses/:id/settings.
 *
 * Settings are written to the harness .env, which the agent loads via compose
 * env_file at container creation. A plain restart does NOT reload env_file, so
 * the route must recreate the container for changes to take effect.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'

vi.mock('@/lib/services', () => ({
  services: {
    harness: { restart: vi.fn(), get: vi.fn(() => undefined) },
    config: { getSettings: vi.fn(() => ({})) },
  },
}))
vi.mock('@/lib/resolvers', () => ({
  resolveIdentifier: vi.fn(async () => null),
  expandSignalAllowlist: vi.fn(async (_id: string, users: string[]) => users),
}))
vi.mock('@/lib/services/harness-compose', () => ({ generateStandaloneCompose: vi.fn(() => '') }))
vi.mock('@/lib/env-helpers', () => ({ buildSettingsEnvValue: vi.fn(() => '') }))

import { GET, PUT } from './route'
import { services } from '@/lib/services'
import { expandSignalAllowlist } from '@/lib/resolvers'

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/harnesses/h_test/settings', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('Settings API — PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'readFileSync').mockReturnValue('GITHUB_TOKEN=x\n' as never)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('recreates the harness after writing settings (quick restart would not reload env_file)', async () => {
    const body = {
      dmPolicy: 'approved-only',
      groupInvitePolicy: 'approved-only',
      mentionGating: true,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {},
    }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(fs.writeFileSync).toHaveBeenCalled()
    expect(services.harness.restart).toHaveBeenCalledWith('h_test', 'recreate')
  })

  it('expands Signal allowed users to include resolved UUIDs before writing', async () => {
    const body = {
      dmPolicy: 'approved-only',
      groupInvitePolicy: 'approved-only',
      mentionGating: true,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {
        signal: {
          allowedUsers: ['+15550001234'],
          adminUsers: ['+15550001234'],
          allowedGroups: [],
          allowAll: false,
          allowAllGroups: false,
        },
      },
    }
    await PUT(makeRequest(body), makeParams('h_test'))

    expect(expandSignalAllowlist).toHaveBeenCalledWith('h_test', ['+15550001234'])
  })
})

describe('Settings API — GET mention-gating reflects the runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  async function getWithEnv(envContent: string) {
    // GET reads the .env (and best-effort resolved-identities.json) via readFileSync.
    // Returning the .env for every path is fine — the JSON.parse of it fails soft → {}.
    vi.spyOn(fs, 'readFileSync').mockReturnValue(envContent as never)
    const res = await GET(makeRequest({}) as Request, makeParams('h_test'))
    return res.json() as Promise<{ mentionGating: boolean }>
  }

  it('reports gated when the value is explicitly truthy', async () => {
    expect((await getWithEnv('SIGNAL_REQUIRE_MENTION=true\n')).mentionGating).toBe(true)
  })

  it('reports NOT gated when the value is empty — the runtime treats "" as false', async () => {
    // This is the Mare bug: an empty value reads as false at runtime, but the UI
    // used to claim "@mention only", so the agent answered every message while
    // the setting appeared on.
    expect((await getWithEnv('SIGNAL_REQUIRE_MENTION=\n')).mentionGating).toBe(false)
  })

  it('reports NOT gated when the value is an explicit false', async () => {
    expect((await getWithEnv('SIGNAL_REQUIRE_MENTION=false\n')).mentionGating).toBe(false)
  })

  it('reports NOT gated when the line is absent — runtime default is not-gated', async () => {
    expect((await getWithEnv('GITHUB_TOKEN=x\n')).mentionGating).toBe(false)
  })
})
