import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildConnectEnvVars, mergeEnvVars, ensurePolicyDefaults } from '@/lib/env-helpers'

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

  const envVars = buildConnectEnvVars(platform, config)
  if (Object.keys(envVars).length === 0) {
    return NextResponse.json({ error: `Unknown platform: ${platform}` }, { status: 400 })
  }

  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: `Agent .env not found at ${envPath}` }, { status: 404 })
  }

  let content = fs.readFileSync(envPath, 'utf-8')

  // Only write connection-specific vars (URL, token, account).
  // Never touch policy vars (ALLOWED_USERS, GROUP_ALLOWED_USERS).
  content = mergeEnvVars(content, envVars)

  // Ensure policy defaults exist for new connections (empty = approved-only).
  content = ensurePolicyDefaults(content, platform)

  fs.writeFileSync(envPath, content, { mode: 0o600 })

  return NextResponse.json({ success: true, envVars: Object.keys(envVars) })
}
