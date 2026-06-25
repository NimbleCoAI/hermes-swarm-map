import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { services } from '@/lib/services'

function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

const PLATFORM_ENV_KEYS: Record<string, string[]> = {
  signal: [
    'SIGNAL_ACCOUNT',
    'SIGNAL_HTTP_URL',
    'SIGNAL_ALLOWED_USERS',
    'SIGNAL_GROUP_ALLOWED_USERS',
  ],
  telegram: [
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_ALLOWED_USERS',
    'TELEGRAM_GROUP_ALLOWED_CHATS',
  ],
  mattermost: [
    'MATTERMOST_URL',
    'MATTERMOST_TOKEN',
    'MATTERMOST_ALLOWED_CHANNELS',
    'MATTERMOST_ALLOWED_USERS',
    'MATTERMOST_ADMIN_USERS',
  ],
  discord: [
    'DISCORD_BOT_TOKEN',
    'DISCORD_ALLOWED_USERS',
    'DISCORD_ALLOWED_CHANNELS',
  ],
  slack: [
    'SLACK_BOT_TOKEN',
    'SLACK_APP_TOKEN',
    'SLACK_ALLOWED_USERS',
    'SLACK_ALLOWED_CHANNELS',
  ],
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { platform } = body as { platform: string }

  if (!platform) {
    return NextResponse.json({ error: 'Missing platform' }, { status: 400 })
  }

  const keys = PLATFORM_ENV_KEYS[platform]
  if (!keys) {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 })
  }

  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: `Agent .env not found at ${envPath}` }, { status: 404 })
  }

  let content = fs.readFileSync(envPath, 'utf-8')

  for (const key of keys) {
    content = content.replace(new RegExp(`^${key}=.*\n?`, 'm'), '')
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 })

  // Recreate so the gateway actually drops the surface. Stripping vars from
  // .env without recreating leaves the live connection running on stale env.
  let restarted = false
  try {
    services.harness.restart(id, 'recreate')
    restarted = true
  } catch {
    // No compose file — env is stripped; nothing live to recreate.
  }

  return NextResponse.json({ ok: true, restarted })
}
