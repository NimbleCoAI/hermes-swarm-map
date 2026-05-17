import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

const ENV_MAP: Record<string, (config: Record<string, string>) => Record<string, string>> = {
  signal: (c) => ({
    SIGNAL_HTTP_URL: c.url || 'http://host.docker.internal:8080',
    SIGNAL_ACCOUNT: c.phone,
    SIGNAL_ALLOWED_USERS: c.allowedUsers || '',
    SIGNAL_GROUP_ALLOWED_USERS: c.groupAllowedUsers || '',
  }),
  telegram: (c) => ({
    TELEGRAM_BOT_TOKEN: c.token,
  }),
  mattermost: (c) => ({
    MATTERMOST_URL: c.url,
    MATTERMOST_TOKEN: c.token,
  }),
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json()
  const { platform, config } = body as { platform: string; config: Record<string, string> }

  if (!platform || !config) {
    return NextResponse.json({ error: 'Missing platform or config' }, { status: 400 })
  }

  const mapper = ENV_MAP[platform]
  if (!mapper) {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 })
  }

  const envVars = mapper(config)
  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: `Agent .env not found at ${envPath}` }, { status: 404 })
  }

  let content = fs.readFileSync(envPath, 'utf-8')

  for (const [key, value] of Object.entries(envVars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`)
    } else {
      content = content.trimEnd() + `\n${key}=${value}\n`
    }
  }

  fs.writeFileSync(envPath, content, { mode: 0o600 })

  return NextResponse.json({ success: true, envVars: Object.keys(envVars) })
}
