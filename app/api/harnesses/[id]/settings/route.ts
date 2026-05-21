import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildSettingsEnvValue } from '@/lib/env-helpers'

function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

// Env var names that map to permission settings, per platform
const PLATFORM_VARS: Record<string, { users: string; groups: string; admins: string }> = {
  signal: { users: 'SIGNAL_ALLOWED_USERS', groups: 'SIGNAL_GROUP_ALLOWED_USERS', admins: 'SIGNAL_ADMIN_USERS' },
  telegram: { users: 'TELEGRAM_ALLOWED_USERS', groups: 'TELEGRAM_GROUP_ALLOWED_CHATS', admins: 'TELEGRAM_ADMIN_USERS' },
  mattermost: { users: 'MATTERMOST_ALLOWED_USERS', groups: 'MATTERMOST_ALLOWED_CHANNELS', admins: 'MATTERMOST_ADMIN_USERS' },
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
  allowedGroups: string[]
  adminUsers: string[]
  allowAll: boolean
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

// Global env var for command approval restriction
const COMMAND_APPROVAL_VAR = 'HERMES_APPROVAL_ADMIN_ONLY'

type SettingsResponse = {
  dmPolicy: 'approved-only' | 'allow-all'
  groupInvitePolicy: 'approved-only' | 'allow-all'
  mentionGating: boolean
  commandApprovalAdminOnly: boolean
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

  // Determine if any platform has allow-all
  let hasAllowAll = false

  for (const [platform, vars] of Object.entries(PLATFORM_VARS)) {
    const usersRaw = env[vars.users]
    const groupsRaw = env[vars.groups]
    const adminsRaw = env[vars.admins]

    const allowAll = usersRaw === '*'
    if (allowAll) hasAllowAll = true

    surfaces[platform] = {
      allowedUsers: parseCommaList(usersRaw),
      allowedGroups: parseCommaList(groupsRaw),
      adminUsers: parseCommaList(adminsRaw),
      allowAll,
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

  const response: SettingsResponse = {
    dmPolicy: hasAllowAll ? 'allow-all' : 'approved-only',
    groupInvitePolicy,
    mentionGating,
    commandApprovalAdminOnly,
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

    // Users — empty string = no one allowed (secure default), * = allow all
    const usersValue = buildSettingsEnvValue(body.dmPolicy, settings.allowAll, settings.allowedUsers)
    const usersRegex = new RegExp(`^${vars.users}=.*$`, 'm')
    if (usersRegex.test(content)) {
      content = content.replace(usersRegex, `${vars.users}=${usersValue}`)
    } else {
      content = content.trimEnd() + `\n${vars.users}=${usersValue}\n`
    }

    // Groups — empty string = no groups allowed, * = all groups
    const groupsValue = settings.allowedGroups.length > 0
      ? settings.allowedGroups.join(',')
      : ''
    const groupsRegex = new RegExp(`^${vars.groups}=.*$`, 'm')
    if (groupsRegex.test(content)) {
      content = content.replace(groupsRegex, `${vars.groups}=${groupsValue}`)
    } else {
      content = content.trimEnd() + `\n${vars.groups}=${groupsValue}\n`
    }

    // Admins
    const adminsValue = settings.adminUsers.length > 0
      ? settings.adminUsers.join(',')
      : ''
    const adminsRegex = new RegExp(`^${vars.admins}=.*$`, 'm')
    if (adminsRegex.test(content)) {
      content = content.replace(adminsRegex, `${vars.admins}=${adminsValue}`)
    } else {
      content = content.trimEnd() + `\n${vars.admins}=${adminsValue}\n`
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

  // Command approval — write global env var
  const commandApprovalValue = body.commandApprovalAdminOnly !== false ? 'true' : 'false'
  const commandApprovalRegex = new RegExp(`^${COMMAND_APPROVAL_VAR}=.*$`, 'm')
  if (commandApprovalRegex.test(content)) {
    content = content.replace(commandApprovalRegex, `${COMMAND_APPROVAL_VAR}=${commandApprovalValue}`)
  } else {
    content = content.trimEnd() + `\n${COMMAND_APPROVAL_VAR}=${commandApprovalValue}\n`
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 })

  return NextResponse.json({ success: true })
}
