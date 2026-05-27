import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getCostMonth } from '@/lib/services/usage'
import { services } from '@/lib/services'

function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

/** Env var that holds the group allowlist for each platform */
const GROUP_VARS: Record<string, string> = {
  signal: 'SIGNAL_GROUP_ALLOWED_USERS',
  telegram: 'TELEGRAM_GROUP_ALLOWED_CHATS',
  mattermost: 'MATTERMOST_ALLOWED_CHANNELS',
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
  if (!value) return []
  return value.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * GET /api/harnesses/:id/policy?action=group-check&platform=signal&chatId=abc
 * GET /api/harnesses/:id/policy?action=budget-check
 *
 * Dispatches to the appropriate policy check based on the action parameter.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const url = new URL(request.url)
  const action = url.searchParams.get('action') || 'group-check'

  if (action === 'budget-check') {
    return handleBudgetCheck(id)
  }

  // Default: group-check
  const platform = url.searchParams.get('platform')
  const chatId = url.searchParams.get('chatId')

  if (!platform || !chatId) {
    return NextResponse.json({ error: 'Missing platform or chatId' }, { status: 400 })
  }

  const groupVar = GROUP_VARS[platform]
  if (!groupVar) {
    return NextResponse.json({ error: `Unsupported platform: ${platform}` }, { status: 400 })
  }

  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: 'Agent .env not found' }, { status: 404 })
  }

  const env = parseEnvFile(envPath)
  const rawValue = env[groupVar]

  // Wildcard = all groups allowed
  if (rawValue === '*') {
    return NextResponse.json({ allowed: true })
  }

  // Check membership
  const groups = parseCommaList(rawValue)
  const allowed = groups.includes(chatId)

  return NextResponse.json({ allowed })
}

/**
 * Budget check: compare monthly spend against key budgets assigned to this harness.
 */
function handleBudgetCheck(harnessId: string) {
  const costMonth = getCostMonth(harnessId)

  // Sum budgets from all keys assigned to this harness
  const allKeys = services.keys.list()
  const assignedKeys = allKeys.filter(k => k.assignedTo.includes(harnessId))
  const totalBudget = assignedKeys.reduce((sum, k) => sum + (k.budgetUsd ?? 0), 0)

  // No budget configured — no enforcement
  if (totalBudget === 0) {
    return NextResponse.json({ budget: null, exceeded: false })
  }

  return NextResponse.json({
    budget: totalBudget,
    costMonth,
    exceeded: costMonth >= totalBudget,
    remaining: totalBudget - costMonth,
  })
}

/**
 * POST /api/harnesses/:id/policy
 * body: { action: "group-register"|"group-deregister", platform, chatId, chatName? }
 *
 * Register or deregister a group in the agent's .env allowlist.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await request.json() as {
    action: string
    platform: string
    chatId: string
    chatName?: string
  }

  const { action, platform, chatId } = body

  if (!action || !['group-register', 'group-deregister'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  if (!platform || !chatId) {
    return NextResponse.json({ error: 'Missing platform or chatId' }, { status: 400 })
  }

  const groupVar = GROUP_VARS[platform]
  if (!groupVar) {
    return NextResponse.json({ error: `Unsupported platform: ${platform}` }, { status: 400 })
  }

  const dataDir = agentDataDir(id)
  const envPath = path.join(dataDir, '.env')

  if (!fs.existsSync(envPath)) {
    return NextResponse.json({ error: 'Agent .env not found' }, { status: 404 })
  }

  let content = fs.readFileSync(envPath, 'utf-8')
  const env = parseEnvFile(envPath)
  const currentGroups = parseCommaList(env[groupVar])

  if (action === 'group-register') {
    // Append if not already present
    if (!currentGroups.includes(chatId)) {
      const newGroups = [...currentGroups, chatId]
      const newValue = newGroups.join(',')
      const regex = new RegExp(`^${groupVar}=.*$`, 'm')
      if (regex.test(content)) {
        content = content.replace(regex, `${groupVar}=${newValue}`)
      } else {
        content = content.trimEnd() + `\n${groupVar}=${newValue}\n`
      }
      fs.writeFileSync(envPath, content, { mode: 0o600 })
    } else {
      // Already present — write unchanged (idempotent)
      fs.writeFileSync(envPath, content, { mode: 0o600 })
    }
    return NextResponse.json({ success: true })
  }

  if (action === 'group-deregister') {
    // Remove chatId from list
    const newGroups = currentGroups.filter(g => g !== chatId)
    const newValue = newGroups.join(',')
    const regex = new RegExp(`^${groupVar}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${groupVar}=${newValue}`)
    }
    // If var didn't exist, nothing to remove
    fs.writeFileSync(envPath, content, { mode: 0o600 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
