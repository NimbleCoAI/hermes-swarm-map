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
    surfaceAdmins: { syncFromAllowlist: vi.fn() },
  },
}))
vi.mock('@/lib/resolvers', () => ({
  resolveIdentifier: vi.fn(async () => null),
  expandSignalAllowlist: vi.fn(async (_id: string, users: string[]) => users),
  expandTelegramAllowlist: vi.fn(async (_id: string, users: string[]) => users),
}))
vi.mock('@/lib/services/harness-compose', () => ({ generateStandaloneCompose: vi.fn(() => '') }))
vi.mock('@/lib/env-helpers', () => ({ buildSettingsEnvValue: vi.fn(() => '') }))

import { GET, PUT } from './route'
import { services } from '@/lib/services'
import { expandSignalAllowlist, expandTelegramAllowlist } from '@/lib/resolvers'

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

  it('includes restarted:true in the response so the UI does not fire a second restart POST', async () => {
    // The UI's handleSettingsSave() previously fired a separate POST /restart after
    // the settings PUT. This collides with the recreate's restart-lock and returns
    // 409 "restart already in progress", which the UI surfaces as "restart failed —
    // restart manually". Fix: PUT returns restarted:true; UI drives its toast from
    // that flag instead of firing a second restart.
    const body = {
      dmPolicy: 'approved-only',
      groupInvitePolicy: 'approved-only',
      mentionGating: false,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {},
    }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.restarted).toBe(true)
    // Restart must be called exactly once — the recreate in the PUT handler.
    // A second restart call from the UI would hit the lock and 409.
    expect(services.harness.restart).toHaveBeenCalledTimes(1)
    expect(services.harness.restart).toHaveBeenCalledWith('h_test', 'recreate')
  })

  // Capture the content written to the agent .env (the first writeFileSync arg is
  // the path; a later write targets resolved-identities.json, so match on .env).
  function writtenEnv(): string {
    const calls = (fs.writeFileSync as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const envCall = calls.find(c => typeof c[0] === 'string' && (c[0] as string).endsWith('.env'))
    return (envCall?.[1] as string) ?? ''
  }

  it('writes SLACK_CHANNEL_POLICY alongside SIGNAL_GROUP_INVITE_POLICY when group invite policy is approved-only', async () => {
    // The group-invite-policy toggle must also drive Slack: HSM previously wrote
    // only the Signal var, so the toggle silently no-op'd for Slack agents. Both
    // vars now come from the same body.groupInvitePolicy value.
    const body = {
      dmPolicy: 'approved-only',
      groupInvitePolicy: 'approved-only',
      mentionGating: true,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {},
    }
    await PUT(makeRequest(body), makeParams('h_test'))
    const env = writtenEnv()
    expect(env).toContain('SLACK_CHANNEL_POLICY=approved-only')
    expect(env).toContain('SIGNAL_GROUP_INVITE_POLICY=approved-only')
    expect(env).toContain('TELEGRAM_GROUP_INVITE_POLICY=approved-only')
  })

  it('writes SLACK_CHANNEL_POLICY=allow-all when group invite policy is allow-all', async () => {
    const body = {
      dmPolicy: 'approved-only',
      groupInvitePolicy: 'allow-all',
      mentionGating: true,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {},
    }
    await PUT(makeRequest(body), makeParams('h_test'))
    const env = writtenEnv()
    expect(env).toContain('SLACK_CHANNEL_POLICY=allow-all')
    expect(env).toContain('SIGNAL_GROUP_INVITE_POLICY=allow-all')
    expect(env).toContain('TELEGRAM_GROUP_INVITE_POLICY=allow-all')
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

  it('expands Telegram @usernames and syncs the policy-plane admin overlay', async () => {
    // Two stores hold Telegram admins: the .env allowlist (bootstrap) and the
    // SurfaceAdminService overlay (served live to the policy plugin). A settings
    // write must keep them converged — and expand @handles to numeric IDs, since
    // the gateway matches numeric sender IDs verbatim.
    ;(expandTelegramAllowlist as ReturnType<typeof vi.fn>).mockResolvedValueOnce(['@juniper', '424242'])
    const body = {
      dmPolicy: 'approved-only',
      groupInvitePolicy: 'approved-only',
      mentionGating: true,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {
        telegram: {
          allowedUsers: ['@juniper'],
          adminUsers: ['@juniper'],
          allowedGroups: [],
          allowAll: false,
          allowAllGroups: false,
        },
      },
    }
    await PUT(makeRequest(body), makeParams('h_test'))

    expect(expandTelegramAllowlist).toHaveBeenCalledWith('h_test', ['@juniper'])
    expect(services.surfaceAdmins.syncFromAllowlist).toHaveBeenCalledWith(
      'h_test', 'telegram', ['@juniper', '424242'],
    )
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

describe('Settings API — GET group invite policy read-back', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  async function getPolicy(envContent: string) {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(envContent as never)
    const res = await GET(makeRequest({}) as Request, makeParams('h_test'))
    return (await res.json()) as { groupInvitePolicy: 'approved-only' | 'allow-all' }
  }

  it('defaults to approved-only when no policy vars are set', async () => {
    expect((await getPolicy('GITHUB_TOKEN=x\n')).groupInvitePolicy).toBe('approved-only')
  })

  it('reports allow-all when both vars agree on allow-all', async () => {
    const env = 'SIGNAL_GROUP_INVITE_POLICY=allow-all\nSLACK_CHANNEL_POLICY=allow-all\n'
    expect((await getPolicy(env)).groupInvitePolicy).toBe('allow-all')
  })

  it('reports allow-all from an older .env that only has the Signal var', async () => {
    expect((await getPolicy('SIGNAL_GROUP_INVITE_POLICY=allow-all\n')).groupInvitePolicy).toBe('allow-all')
  })

  it('prefers approved-only when the vars disagree — secure reading wins', async () => {
    // Hand-edited/legacy .env where one surface is locked down and the other open.
    const env = 'SIGNAL_GROUP_INVITE_POLICY=approved-only\nSLACK_CHANNEL_POLICY=allow-all\n'
    expect((await getPolicy(env)).groupInvitePolicy).toBe('approved-only')
  })
})
