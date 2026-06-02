import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildConnectEnvVars, mergeEnvVars, ensurePolicyDefaults, getSignalDaemonUrl } from '@/lib/env-helpers'

function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
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

  // Pre-connect health check for Signal (uses JSON-RPC since daemon runs in native mode)
  if (platform === 'signal') {
    const signalUrl = getSignalDaemonUrl()
    try {
      const healthRes = await fetch(`${signalUrl}/api/v1/rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'listAccounts', id: 'health' }),
        signal: AbortSignal.timeout(5000),
      })
      if (!healthRes.ok) {
        return NextResponse.json({ error: 'Signal daemon not reachable. Deploy it first via Settings or run: cd ~/.hermes-swarm && docker compose -f docker-compose.signal.yml up -d' }, { status: 503 })
      }
    } catch {
      return NextResponse.json({ error: 'Signal daemon not reachable. Deploy it first via Settings or run: cd ~/.hermes-swarm && docker compose -f docker-compose.signal.yml up -d' }, { status: 503 })
    }
  }

  const envVars = buildConnectEnvVars(platform, config)
  if (Object.keys(envVars).length === 0) {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 })
  }

  // If adminUser is provided, set the platform's ALLOWED_USERS var
  if (config.adminUser) {
    const allowedUsersKey: Record<string, string> = {
      signal: 'SIGNAL_ALLOWED_USERS',
      telegram: 'TELEGRAM_ALLOWED_USERS',
      mattermost: 'MATTERMOST_ALLOWED_USERS',
    }
    const key = allowedUsersKey[platform]
    if (key) {
      envVars[key] = config.adminUser
    }
  }

  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: `Agent .env not found at ${envPath}` }, { status: 404 })
  }

  let content = fs.readFileSync(envPath, 'utf-8')

  // Only write connection-specific vars (URL, token, account).
  // Never touch policy vars (ALLOWED_USERS, GROUP_ALLOWED_USERS) — unless adminUser was explicitly provided.
  content = mergeEnvVars(content, envVars)

  // Ensure policy defaults exist for new connections (empty = approved-only).
  content = ensurePolicyDefaults(content, platform)

  fs.writeFileSync(envPath, content, { mode: 0o600 })

  return NextResponse.json({ success: true, envVars: Object.keys(envVars) })
}
