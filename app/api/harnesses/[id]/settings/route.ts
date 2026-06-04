import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildSettingsEnvValue } from '@/lib/env-helpers'
import { resolveIdentifier, expandSignalAllowlist } from '@/lib/resolvers'
import { services } from '@/lib/services'
import { generateStandaloneCompose } from '@/lib/services/harness-compose'

function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

// Env var names that map to permission settings, per platform
const PLATFORM_VARS: Record<string, { users: string; groups: string }> = {
  signal: { users: 'SIGNAL_ALLOWED_USERS', groups: 'SIGNAL_GROUP_ALLOWED_USERS' },
  telegram: { users: 'TELEGRAM_ALLOWED_USERS', groups: 'TELEGRAM_GROUP_ALLOWED_CHATS' },
  mattermost: { users: 'MATTERMOST_ALLOWED_USERS', groups: 'MATTERMOST_ALLOWED_CHANNELS' },
}

function parseEnvFile(envPath: string): Record<string, string> {
  const result: Record<string, string> = {}
  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq === -1) continue
      const key = line.slice(0, eq).trim()
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (key) result[key] = value
    }
  } catch {}
  return result
}

function parseCommaList(value: string | undefined): string[] {
  if (!value || value === '*') return []
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

type SurfaceSettings = {
  allowedUsers: string[]
  adminUsers: string[]
  allowedGroups: string[]
  allowAll: boolean
  allowAllGroups: boolean
}

// Env var names for group invite policy per platform
const GROUP_INVITE_VARS: Record<string, string> = {
  signal: 'SIGNAL_GROUP_INVITE_POLICY',
}

// Env var names for mention-gating per platform
const MENTION_GATING_VARS: Record<string, string> = {
  signal: 'SIGNAL_REQUIRE_MENTION',
  telegram: 'TELEGRAM_REQUIRE_MENTION',
  mattermost: 'MATTERMOST_REQUIRE_MENTION',
}

// Env var names for observing unmentioned messages per platform
const OBSERVE_UNMENTIONED_VARS: Record<string, string> = {
  signal: 'SIGNAL_OBSERVE_UNMENTIONED',
  mattermost: 'MATTERMOST_OBSERVE_UNMENTIONED',
  telegram: 'TELEGRAM_OBSERVE_UNMENTIONED_GROUP_MESSAGES',
}

// Global env vars for policy settings
const COMMAND_APPROVAL_VAR = 'HERMES_APPROVAL_ADMIN_ONLY'
const DM_POLICY_VAR = 'HERMES_DM_POLICY'
const VPN_ENABLED_VAR = 'VPN_ENABLED'
const CAPSOLVER_KEY_VAR = 'CAPSOLVER_API_KEY'
const VNC_EXTERNAL_URL_VAR = 'VNC_EXTERNAL_URL'

type SettingsResponse = {
  dmPolicy: 'approved-only' | 'allow-all'
  groupInvitePolicy: 'approved-only' | 'allow-all'
  mentionGating: boolean
  commandApprovalAdminOnly: boolean
  memoryScope: 'channel' | 'global'
  vpnEnabled: boolean
  capsolverConfigured: boolean
  surfaces: Record<string, SurfaceSettings>
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: 'Agent .env not found' }, { status: 404 })
  }

  const env = parseEnvFile(envPath)
  const surfaces: Record<string, SurfaceSettings> = {}

  for (const [platform, vars] of Object.entries(PLATFORM_VARS)) {
    const usersRaw = env[vars.users]
    const groupsRaw = env[vars.groups]

    const allowAll = usersRaw === '*'
    const allowAllGroups = groupsRaw === '*'

    const users = parseCommaList(usersRaw)
    surfaces[platform] = {
      allowedUsers: users,
      adminUsers: users,  // backward compat — old plugins read this field
      allowedGroups: parseCommaList(groupsRaw),
      allowAll,
      allowAllGroups,
    }
  }

  // Read group invite policy — check any platform's env var (Signal is primary)
  let groupInvitePolicy: 'approved-only' | 'allow-all' = 'approved-only'
  for (const varName of Object.values(GROUP_INVITE_VARS)) {
    const val = env[varName]
    if (val === 'allow-all') {
      groupInvitePolicy = 'allow-all'
      break
    }
  }

  // Read mention-gating — default true (require mention) unless any platform explicitly set to 'false'
  let mentionGating = true
  for (const varName of Object.values(MENTION_GATING_VARS)) {
    const val = env[varName]
    if (val === 'false') {
      mentionGating = false
      break
    }
  }

  // Read command approval setting — default true (admin-only) unless explicitly 'false'
  const commandApprovalAdminOnly = env[COMMAND_APPROVAL_VAR] !== 'false'

  // Memory scope — default 'channel' (per-chat isolation)
  const memoryScope: 'channel' | 'global' = env['HERMES_MEMORY_SCOPE'] === 'global' ? 'global' : 'channel'

  // DM policy — stored as its own env var, not derived from per-platform wildcards
  const dmPolicy: 'approved-only' | 'allow-all' = env[DM_POLICY_VAR] === 'allow-all' ? 'allow-all' : 'approved-only'

  // Enrich with resolved identities
  const resolvedPath = path.join(dataDir, 'resolved-identities.json')
  let resolvedIdentities: Record<string, Array<{ display: string; nativeId: string; profileName?: string }>> = {}
  try {
    resolvedIdentities = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'))
  } catch {}

  for (const [platform, surf] of Object.entries(surfaces)) {
    const resolved = resolvedIdentities[platform]
    if (resolved?.length) {
      (surf as any).resolvedUsers = resolved
      // Merge native IDs into allowedUsers so is_platform_admin matches
      const nativeIds = resolved.map(r => r.nativeId).filter(Boolean)
      if (nativeIds.length > 0) {
        (surf as any).allowedUsers = [...new Set([...(surf as any).allowedUsers, ...nativeIds])]
        ;(surf as any).adminUsers = (surf as any).allowedUsers
      }
    }
  }

  // VPN + CapSolver status
  const vpnEnabled = env[VPN_ENABLED_VAR] === 'true'
  const capsolverConfigured = !!env[CAPSOLVER_KEY_VAR]

  const response: SettingsResponse = {
    dmPolicy,
    groupInvitePolicy,
    mentionGating,
    commandApprovalAdminOnly,
    memoryScope,
    vpnEnabled,
    capsolverConfigured,
    surfaces,
  }

  return NextResponse.json(response)
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: 'Agent .env not found' }, { status: 404 })
  }

  const body = await request.json() as SettingsResponse

  let content = fs.readFileSync(envPath, 'utf-8')

  for (const [platform, vars] of Object.entries(PLATFORM_VARS)) {
    const settings = body.surfaces[platform]
    if (!settings) continue

    // Users — empty string = no one allowed (secure default), * = allow all.
    // For Signal, expand phone numbers to also include their resolved UUID:
    // sealed-sender DMs identify the sender only by UUID, so a phone-only
    // allowlist silently rejects them (see expandSignalAllowlist).
    let allowedUsers = settings.allowedUsers
    if (platform === 'signal' && allowedUsers.length > 0) {
      allowedUsers = await expandSignalAllowlist(id, allowedUsers)
    }
    const usersValue = buildSettingsEnvValue(body.dmPolicy, settings.allowAll, allowedUsers)
    const usersRegex = new RegExp(`^${vars.users}=.*$`, 'm')
    if (usersRegex.test(content)) {
      content = content.replace(usersRegex, `${vars.users}=${usersValue}`)
    } else {
      content = content.trimEnd() + `\n${vars.users}=${usersValue}\n`
    }

    // Groups — explicit list takes priority, then allowAllGroups → *, else empty
    const groupsValue = settings.allowedGroups.length > 0
      ? settings.allowedGroups.join(',')
      : settings.allowAllGroups ? '*' : ''
    const groupsRegex = new RegExp(`^${vars.groups}=.*$`, 'm')
    if (groupsRegex.test(content)) {
      content = content.replace(groupsRegex, `${vars.groups}=${groupsValue}`)
    } else {
      content = content.trimEnd() + `\n${vars.groups}=${groupsValue}\n`
    }

  }

  // Group invite policy — write per-platform env vars
  const groupInviteValue = body.groupInvitePolicy || 'approved-only'
  for (const [, varName] of Object.entries(GROUP_INVITE_VARS)) {
    const regex = new RegExp(`^${varName}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${varName}=${groupInviteValue}`)
    } else {
      content = content.trimEnd() + `\n${varName}=${groupInviteValue}\n`
    }
  }

  // Mention-gating — write per-platform env vars
  const mentionGatingValue = body.mentionGating !== false ? 'true' : 'false'
  for (const [, varName] of Object.entries(MENTION_GATING_VARS)) {
    const regex = new RegExp(`^${varName}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${varName}=${mentionGatingValue}`)
    } else {
      content = content.trimEnd() + `\n${varName}=${mentionGatingValue}\n`
    }
  }

  // Observe-unmentioned — when mention-gating is on, silently record unmentioned messages;
  // when off (responding to everything), observation is not needed
  const observeValue = body.mentionGating !== false ? 'true' : 'false'
  for (const [, varName] of Object.entries(OBSERVE_UNMENTIONED_VARS)) {
    const regex = new RegExp(`^${varName}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${varName}=${observeValue}`)
    } else {
      content = content.trimEnd() + `\n${varName}=${observeValue}\n`
    }
  }

  // Command approval — write global env var
  const commandApprovalValue = body.commandApprovalAdminOnly !== false ? 'true' : 'false'
  const commandApprovalRegex = new RegExp(`^${COMMAND_APPROVAL_VAR}=.*$`, 'm')
  if (commandApprovalRegex.test(content)) {
    content = content.replace(commandApprovalRegex, `${COMMAND_APPROVAL_VAR}=${commandApprovalValue}`)
  } else {
    content = content.trimEnd() + `\n${COMMAND_APPROVAL_VAR}=${commandApprovalValue}\n`
  }

  // DM policy — stored as its own env var so it persists correctly
  const dmPolicyValue = body.dmPolicy || 'approved-only'
  const dmPolicyRegex = new RegExp(`^${DM_POLICY_VAR}=.*$`, 'm')
  if (dmPolicyRegex.test(content)) {
    content = content.replace(dmPolicyRegex, `${DM_POLICY_VAR}=${dmPolicyValue}`)
  } else {
    content = content.trimEnd() + `\n${DM_POLICY_VAR}=${dmPolicyValue}\n`
  }

  // Memory scope
  const memoryScopeValue = body.memoryScope === 'global' ? 'global' : 'channel'
  const memoryScopeRegex = /^HERMES_MEMORY_SCOPE=.*$/m
  if (memoryScopeRegex.test(content)) {
    content = content.replace(memoryScopeRegex, `HERMES_MEMORY_SCOPE=${memoryScopeValue}`)
  } else {
    content = content.trimEnd() + `\nHERMES_MEMORY_SCOPE=${memoryScopeValue}\n`
  }

  // VPN toggle + externally-reachable VNC URL for human CAPTCHA escalation
  if ((body as any).vpnEnabled !== undefined) {
    const vpnEnabled = !!(body as any).vpnEnabled
    const vpnValue = vpnEnabled ? 'true' : 'false'
    const vpnRegex = new RegExp(`^${VPN_ENABLED_VAR}=.*$`, 'm')
    if (vpnRegex.test(content)) {
      content = content.replace(vpnRegex, `${VPN_ENABLED_VAR}=${vpnValue}`)
    } else {
      content = content.trimEnd() + `\n${VPN_ENABLED_VAR}=${vpnValue}\n`
    }

    // The captcha plugin DMs this URL to a human. Port = agent port + 2000
    // (see harness-compose); host = the configured VNC bind host (loopback by
    // default — set settings.vncBindHost to a Tailscale address for remote
    // escalation). Cleared when VPN is disabled.
    const vncBindHost = services.config.getSettings().vncBindHost || '127.0.0.1'
    const harness = services.harness.get(id)
    let vncExternalUrl = ''
    if (vpnEnabled && harness?.composeFile && fs.existsSync(harness.composeFile)) {
      const existingCompose = fs.readFileSync(harness.composeFile, 'utf-8')
      const portMatch = existingCompose.match(/published:\s*(\d+)/)
      const port = portMatch ? parseInt(portMatch[1], 10) : 8642
      vncExternalUrl = `http://${vncBindHost}:${port + 2000}`
    }
    const vncRegex = new RegExp(`^${VNC_EXTERNAL_URL_VAR}=.*$`, 'm')
    if (vncRegex.test(content)) {
      content = content.replace(vncRegex, `${VNC_EXTERNAL_URL_VAR}=${vncExternalUrl}`)
    } else if (vncExternalUrl) {
      content = content.trimEnd() + `\n${VNC_EXTERNAL_URL_VAR}=${vncExternalUrl}\n`
    }
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 })

  // Regenerate compose file when VPN toggle changes
  if ((body as any).vpnEnabled !== undefined) {
    const harness = services.harness.get(id)
    if (harness?.composeFile && fs.existsSync(harness.composeFile)) {
      // Read current port from existing compose file
      const existingCompose = fs.readFileSync(harness.composeFile, 'utf-8')
      const portMatch = existingCompose.match(/published:\s*(\d+)/)
      const port = portMatch ? parseInt(portMatch[1], 10) : 8642

      const settings = services.config.getSettings()
      const imageOrBuild = settings.useLocalBuild && settings.hermesDir
        ? (() => {
            const resolved = settings.hermesDir!.replace(/^~/, os.homedir())
            try {
              if (fs.existsSync(path.join(resolved, 'Dockerfile'))) {
                return { build: resolved }
              }
            } catch {}
            return undefined
          })()
        : undefined

      const compose = generateStandaloneCompose(harness.name, port, dataDir, {
        vpnEnabled: (body as any).vpnEnabled,
        imageOrBuild,
        defaultImage: settings.defaultImage,
        vncBindHost: settings.vncBindHost,
      })
      fs.writeFileSync(harness.composeFile, compose, 'utf-8')
    }
  }

  // Resolve identifiers to native IDs (best-effort)
  const resolvedMap: Record<string, Array<{ display: string; nativeId: string; profileName?: string }>> = {}
  for (const [platform, settings] of Object.entries(body.surfaces || {})) {
    if (!settings?.allowedUsers?.length) continue
    const resolved: Array<{ display: string; nativeId: string; profileName?: string }> = []
    for (const identifier of settings.allowedUsers) {
      const result = await resolveIdentifier(id, platform, identifier)
      if (result) {
        resolved.push(result)
      } else {
        resolved.push({ display: identifier, nativeId: identifier })
      }
    }
    resolvedMap[platform] = resolved
  }
  const resolvedPath = path.join(dataDir, 'resolved-identities.json')
  try {
    fs.writeFileSync(resolvedPath, JSON.stringify(resolvedMap, null, 2), { mode: 0o600 })
  } catch {}

  // Recreate the container so the updated .env (and, for VPN changes, the
  // regenerated compose) actually loads. env_file is read at container creation,
  // not on a plain restart — without this, settings changes silently no-op until
  // the next manual rebuild.
  try { services.harness.restart(id, 'recreate') } catch {}

  return NextResponse.json({ success: true })
}
