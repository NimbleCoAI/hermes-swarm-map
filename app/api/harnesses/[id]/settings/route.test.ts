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

  it('does NOT sync the overlay on an allow-all/empty telegram allowlist (would wipe an explicit admin roster)', async () => {
    const body = {
      dmPolicy: 'allow-all',
      groupInvitePolicy: 'approved-only',
      mentionGating: true,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {
        telegram: {
          allowedUsers: [],
          adminUsers: [],
          allowedGroups: [],
          allowAll: true,
          allowAllGroups: false,
        },
      },
    }
    await PUT(makeRequest(body), makeParams('h_test'))

    expect(services.surfaceAdmins.syncFromAllowlist).not.toHaveBeenCalled()
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

/**
 * Discord authorization surface.
 *
 * The Discord adapter decides whether to execute a message using four env vars.
 * HSM historically managed two of them, so the console could neither show nor
 * change the settings that actually gate an agent. These tests pin the two
 * inverted semantics (empty channel list, wildcard) and the write path for the
 * three newly-managed vars.
 */
describe('Settings API — Discord authorization vars', () => {
  let written = ''

  function envFixture(lines: string) {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(lines as never)
  }

  function discordBody(discord: Record<string, unknown>) {
    return {
      dmPolicy: 'approved-only',
      groupInvitePolicy: 'approved-only',
      mentionGating: true,
      commandApprovalAdminOnly: true,
      memoryScope: 'channel',
      surfaces: {
        discord: {
          allowedUsers: ['123'],
          adminUsers: ['123'],
          allowedGroups: ['456'],
          allowAll: false,
          allowAllGroups: false,
          ...discord,
        },
      },
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    written = ''
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    envFixture('GITHUB_TOKEN=x\n')
    // Capture the .env write specifically — the route also writes
    // resolved-identities.json, which would otherwise clobber this.
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((p: unknown, data: unknown) => {
      if (typeof data === 'string' && String(p).endsWith('.env')) written = data
    }) as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('never writes an EMPTY DISCORD_ALLOWED_CHANNELS — empty means "every channel" to the adapter', async () => {
    // The adapter gates on `if allowed_channels_raw:`, so an empty value skips the
    // channel check entirely. Clearing the list in the console must not silently
    // widen the bot to the whole guild.
    const res = await PUT(makeRequest(discordBody({ allowedGroups: [], allowAllGroups: false })), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(written).toMatch(/^DISCORD_ALLOWED_CHANNELS=0$/m)
    expect(written).not.toMatch(/^DISCORD_ALLOWED_CHANNELS=$/m)
  })

  it('still honors an explicit allow-all for channels', async () => {
    await PUT(makeRequest(discordBody({ allowedGroups: [], allowAllGroups: true })), makeParams('h_test'))
    expect(written).toMatch(/^DISCORD_ALLOWED_CHANNELS=\*$/m)
  })

  it('writes roles, ignored channels and allowBots when supplied', async () => {
    await PUT(makeRequest(discordBody({
      allowedRoles: ['999'],
      ignoredGroups: ['777', '888'],
      allowBots: 'none',
    })), makeParams('h_test'))
    expect(written).toMatch(/^DISCORD_ALLOWED_ROLES=999$/m)
    expect(written).toMatch(/^DISCORD_IGNORED_CHANNELS=777,888$/m)
    expect(written).toMatch(/^DISCORD_ALLOW_BOTS=none$/m)
  })

  it('leaves a hand-configured value alone when the client omits the field', async () => {
    // An older client PUTs a body with no allowBots/roles. Blanking them would
    // silently re-open an agent an operator hardened by hand.
    envFixture('DISCORD_ALLOW_BOTS=none\nDISCORD_ALLOWED_ROLES=555\n')
    await PUT(makeRequest(discordBody({})), makeParams('h_test'))
    expect(written).toMatch(/^DISCORD_ALLOW_BOTS=none$/m)
    expect(written).toMatch(/^DISCORD_ALLOWED_ROLES=555$/m)
  })

  it('rejects a role NAME — the adapter drops non-numeric entries silently and can fail open', async () => {
    const res = await PUT(makeRequest(discordBody({ allowedRoles: ['moderators'] })), makeParams('h_test'))
    expect(res.status).toBe(400)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })

  it('rejects an unrecognized allowBots value rather than coercing it', async () => {
    // A typo must not land in the permissive branch: the adapter only compares
    // against 'none' first, so anything else skips the human allowlist.
    const res = await PUT(makeRequest(discordBody({ allowBots: 'nonr' as never })), makeParams('h_test'))
    expect(res.status).toBe(400)
    expect(fs.writeFileSync).not.toHaveBeenCalled()
  })
})

describe('Settings API — GET reports the real Discord state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'existsSync').mockImplementation(((p: string) => !String(p).endsWith('resolved-identities.json')) as never)
  })
  afterEach(() => vi.restoreAllMocks())

  it('reports an ABSENT channel allowlist as unscoped, not as a lockdown', async () => {
    // No DISCORD_ALLOWED_CHANNELS at all = responds everywhere. Reporting that as
    // an empty list made "wide open" and "locked down" render identically.
    //
    // It is reported on its OWN field, NOT as allowAllGroups: empty and '*' are
    // different runtime states, and since clients PUT the GET document back,
    // folding them together would write a literal '*' — see the round-trip suite.
    vi.spyOn(fs, 'readFileSync').mockReturnValue('DISCORD_ALLOWED_USERS=123\n' as never)
    const res = await GET(new Request('http://localhost'), makeParams('h_test'))
    const data = await res.json()
    expect(data.surfaces.discord.groupsUnscoped).toBe(true)
    expect(data.surfaces.discord.allowAllGroups).toBe(false)
  })

  it('maps the deny-all sentinel back to an empty list', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('DISCORD_ALLOWED_CHANNELS=0\n' as never)
    const res = await GET(new Request('http://localhost'), makeParams('h_test'))
    const data = await res.json()
    expect(data.surfaces.discord.allowedGroups).toEqual([])
    expect(data.surfaces.discord.allowAllGroups).toBe(false)
  })

  it('surfaces allowBots, defaulting an absent value to none', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('DISCORD_ALLOWED_USERS=123\n' as never)
    const res = await GET(new Request('http://localhost'), makeParams('h_test'))
    const data = await res.json()
    expect(data.surfaces.discord.allowBots).toBe('none')
    expect(data.surfaces.signal.allowBots).toBeUndefined()
  })

  it('surfaces a live permissive allowBots so the console stops hiding it', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('DISCORD_ALLOW_BOTS=mentions\n' as never)
    const res = await GET(new Request('http://localhost'), makeParams('h_test'))
    const data = await res.json()
    expect(data.surfaces.discord.allowBots).toBe('mentions')
  })
})

/**
 * Round-trip safety.
 *
 * Both clients GET the settings document and PUT it back verbatim, so any state
 * GET invents becomes state PUT writes. These pin the cases where that loop
 * would otherwise WIDEN access — found by independent review of the first cut of
 * this change, where reporting an unscoped agent as allowAllGroups round-tripped
 * into a literal '*'.
 */
describe('Settings API — GET→PUT round trip cannot widen access', () => {
  let written = ''

  function capture() {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(((p: unknown, data: unknown) => {
      if (typeof data === 'string' && String(p).endsWith('.env')) written = data
    }) as never)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    written = ''
    vi.spyOn(os, 'homedir').mockReturnValue('/home/test')
    vi.spyOn(fs, 'existsSync').mockImplementation(((p: string) => !String(p).endsWith('resolved-identities.json')) as never)
  })
  afterEach(() => vi.restoreAllMocks())

  async function roundTrip(envContent: string) {
    vi.spyOn(fs, 'readFileSync').mockReturnValue(envContent as never)
    const getRes = await GET(new Request('http://localhost'), makeParams('h_test'))
    const doc = await getRes.json()
    capture()
    const putRes = await PUT(makeRequest(doc), makeParams('h_test'))
    return { doc, status: putRes.status }
  }

  it('an EMPTY channel allowlist does not round-trip into a wildcard', async () => {
    // Empty is NOT '*' at runtime: _discord_channel_ids_allowed returns False on
    // empty and True on '*', and that function is the channel bypass for agents
    // with no user allowlist. Echoing empty back as '*' would take a fail-closed
    // agent to "every guild member can command it".
    const { doc, status } = await roundTrip('DISCORD_ALLOWED_CHANNELS=\n')
    expect(status).toBe(200)
    expect(doc.surfaces.discord.allowAllGroups).toBe(false)
    expect(doc.surfaces.discord.groupsUnscoped).toBe(true)
    expect(written).not.toMatch(/^DISCORD_ALLOWED_CHANNELS=\*$/m)
  })

  it('an ABSENT channel allowlist does not round-trip into a wildcard', async () => {
    const { doc } = await roundTrip('DISCORD_ALLOWED_USERS=123\n')
    expect(doc.surfaces.discord.allowAllGroups).toBe(false)
    expect(doc.surfaces.discord.groupsUnscoped).toBe(true)
    expect(written).not.toMatch(/^DISCORD_ALLOWED_CHANNELS=\*$/m)
  })

  it('a genuine wildcard survives the round trip unchanged', async () => {
    const { doc } = await roundTrip('DISCORD_ALLOWED_CHANNELS=*\nDISCORD_ALLOWED_USERS=123\n')
    expect(doc.surfaces.discord.allowAllGroups).toBe(true)
    expect(written).toMatch(/^DISCORD_ALLOWED_CHANNELS=\*$/m)
  })

  it('a guild-wide DISCORD_IGNORED_CHANNELS mute is not erased', async () => {
    // '*' here mutes the bot guild-wide and is the only kill switch that binds a
    // bot holding Administrator. parseCommaList maps '*' to [], which would have
    // written it back as empty and silently unmuted the agent.
    const { doc } = await roundTrip('DISCORD_IGNORED_CHANNELS=*\nDISCORD_ALLOWED_USERS=123\n')
    expect(doc.surfaces.discord.ignoredGroups).toEqual(['*'])
    expect(written).toMatch(/^DISCORD_IGNORED_CHANNELS=\*$/m)
  })

  it('reports an unrecognized allowBots as permissive, not as none', async () => {
    // The adapter compares against 'none' then 'mentions' and lets anything else
    // fall through to the permissive branch, so a typo is NOT 'none'.
    vi.spyOn(fs, 'readFileSync').mockReturnValue('DISCORD_ALLOW_BOTS=nonr\n' as never)
    const res = await GET(new Request('http://localhost'), makeParams('h_test'))
    const data = await res.json()
    expect(data.surfaces.discord.allowBots).toBe('all')
  })

  it('accepts channels configured by name or #name — the adapter matches those', async () => {
    // _discord_channel_keys_from_channel adds the bare name and '#name' to the key
    // set both gates intersect against, so numeric-only validation would 400 a
    // legitimate config and block the whole save.
    vi.spyOn(fs, 'readFileSync').mockReturnValue('GITHUB_TOKEN=x\n' as never)
    capture()
    const body = {
      dmPolicy: 'approved-only', groupInvitePolicy: 'approved-only', mentionGating: true,
      commandApprovalAdminOnly: true, memoryScope: 'channel',
      surfaces: {
        discord: {
          allowedUsers: ['123'], adminUsers: ['123'],
          allowedGroups: ['the-garden', '#announcements', '456'],
          allowAll: false, allowAllGroups: false,
        },
      },
    }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(200)
    expect(written).toMatch(/^DISCORD_ALLOWED_CHANNELS=the-garden,#announcements,456$/m)
  })

  it('still rejects a channel value that would corrupt the env line', async () => {
    vi.spyOn(fs, 'readFileSync').mockReturnValue('GITHUB_TOKEN=x\n' as never)
    const body = {
      dmPolicy: 'approved-only', groupInvitePolicy: 'approved-only', mentionGating: true,
      commandApprovalAdminOnly: true, memoryScope: 'channel',
      surfaces: {
        discord: {
          allowedUsers: ['123'], adminUsers: ['123'],
          allowedGroups: ['ok\nDISCORD_ALLOWED_USERS=*'],
          allowAll: false, allowAllGroups: false,
        },
      },
    }
    const res = await PUT(makeRequest(body), makeParams('h_test'))
    expect(res.status).toBe(400)
  })
})
