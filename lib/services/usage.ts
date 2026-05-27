import path from 'path'
import os from 'os'
import fs from 'fs'
import Database from 'better-sqlite3'
import { lookupPricing, computeCost, type PricingEntry } from '@/lib/pricing'

export type SessionUsage = {
  sessionId: string
  model: string
  startedAt: number
  endedAt: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  estimatedCostUsd: number
  costStatus: 'estimated' | 'unknown'
}

export type UsageSummary = {
  costToday: number
  costWeek: number
  costMonth: number
  totalTokensToday: number
  sessionCountToday: number
  costStatus: 'estimated' | 'partial' | 'unknown'
  byModel: Array<{
    model: string
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    reasoningTokens: number
    cost: number
    sessionCount: number
    costStatus: 'estimated' | 'unknown'
  }>
  recentSessions: SessionUsage[]
}

type SessionRow = {
  id: string
  model: string | null
  started_at: number
  ended_at: number | null
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
}

type AggRow = {
  model: string
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  reasoning_tokens: number
  session_count: number
}

function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

function startOfDayUnix(): number {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return startOfDay.getTime() / 1000
}

function startOfWeekUnix(): number {
  const now = new Date()
  const day = now.getDay()
  const diff = now.getDate() - day + (day === 0 ? -6 : 1) // Monday
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), diff)
  return startOfWeek.getTime() / 1000
}

function startOfMonthUnix(): number {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  return startOfMonth.getTime() / 1000
}

function computeSessionCost(
  row: { input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; reasoning_tokens: number },
  pricing: PricingEntry | null,
): { cost: number; status: 'estimated' | 'unknown' } {
  if (!pricing) return { cost: 0, status: 'unknown' }
  const cost = computeCost({
    input: row.input_tokens,
    output: row.output_tokens,
    cacheRead: row.cache_read_tokens,
    cacheWrite: row.cache_write_tokens,
    reasoning: row.reasoning_tokens,
  }, pricing)
  return { cost, status: 'estimated' }
}

/**
 * Query a single agent's state.db for cost today.
 * Returns 0 if the db doesn't exist or has no data.
 * Used by HarnessService.list() to populate costToday cheaply.
 */
export function getCostToday(harnessId: string): number {
  const dataDir = agentDataDir(harnessId)
  const dbPath = path.join(dataDir, 'state.db')

  if (!fs.existsSync(dbPath)) return 0

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const todayStart = startOfDayUnix()
      const rows = db.prepare(`
        SELECT model,
               SUM(input_tokens) as input_tokens,
               SUM(output_tokens) as output_tokens,
               SUM(cache_read_tokens) as cache_read_tokens,
               SUM(cache_write_tokens) as cache_write_tokens,
               SUM(reasoning_tokens) as reasoning_tokens
        FROM sessions
        WHERE started_at >= ?
        GROUP BY model
      `).all(todayStart) as AggRow[]

      let total = 0
      for (const row of rows) {
        if (!row.model) continue
        const pricing = lookupPricing(row.model)
        const { cost } = computeSessionCost(row, pricing)
        total += cost
      }
      return total
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}

/**
 * Query a single agent's state.db for cost this month.
 * Returns 0 if the db doesn't exist or has no data.
 * Used by the policy budget-check endpoint.
 */
export function getCostMonth(harnessId: string): number {
  const dataDir = agentDataDir(harnessId)
  const dbPath = path.join(dataDir, 'state.db')

  if (!fs.existsSync(dbPath)) return 0

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const monthStart = startOfMonthUnix()
      const rows = db.prepare(`
        SELECT model,
               SUM(input_tokens) as input_tokens,
               SUM(output_tokens) as output_tokens,
               SUM(cache_read_tokens) as cache_read_tokens,
               SUM(cache_write_tokens) as cache_write_tokens,
               SUM(reasoning_tokens) as reasoning_tokens
        FROM sessions
        WHERE started_at >= ?
        GROUP BY model
      `).all(monthStart) as AggRow[]

      let total = 0
      for (const row of rows) {
        if (!row.model) continue
        const pricing = lookupPricing(row.model)
        const { cost } = computeSessionCost(row, pricing)
        total += cost
      }
      return total
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}

/**
 * Query a single agent's state.db for today's session count.
 * Returns 0 if the db doesn't exist or has no data.
 * Used by HarnessService.list() to populate invocations cheaply.
 */
export function getInvocationsToday(harnessId: string): number {
  const dataDir = agentDataDir(harnessId)
  const dbPath = path.join(dataDir, 'state.db')

  if (!fs.existsSync(dbPath)) return 0

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const todayStart = startOfDayUnix()
      const row = db.prepare(`
        SELECT COUNT(*) as count
        FROM sessions
        WHERE started_at >= ?
      `).get(todayStart) as { count: number } | undefined

      return row?.count ?? 0
    } finally {
      db.close()
    }
  } catch {
    return 0
  }
}

/**
 * Full usage summary for a harness — used by the /usage API endpoint.
 */
export function getUsageSummary(harnessId: string): UsageSummary | null {
  const dataDir = agentDataDir(harnessId)
  const dbPath = path.join(dataDir, 'state.db')

  if (!fs.existsSync(dbPath)) return null

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      const todayStart = startOfDayUnix()
      const weekStart = startOfWeekUnix()
      const monthStart = startOfMonthUnix()

      // Per-model breakdown for today
      const todayRows = db.prepare(`
        SELECT model,
               SUM(input_tokens) as input_tokens,
               SUM(output_tokens) as output_tokens,
               SUM(cache_read_tokens) as cache_read_tokens,
               SUM(cache_write_tokens) as cache_write_tokens,
               SUM(reasoning_tokens) as reasoning_tokens,
               COUNT(*) as session_count
        FROM sessions
        WHERE started_at >= ?
        GROUP BY model
      `).all(todayStart) as AggRow[]

      // Week and month aggregates
      const weekRows = db.prepare(`
        SELECT model,
               SUM(input_tokens) as input_tokens,
               SUM(output_tokens) as output_tokens,
               SUM(cache_read_tokens) as cache_read_tokens,
               SUM(cache_write_tokens) as cache_write_tokens,
               SUM(reasoning_tokens) as reasoning_tokens,
               COUNT(*) as session_count
        FROM sessions
        WHERE started_at >= ?
        GROUP BY model
      `).all(weekStart) as AggRow[]

      const monthRows = db.prepare(`
        SELECT model,
               SUM(input_tokens) as input_tokens,
               SUM(output_tokens) as output_tokens,
               SUM(cache_read_tokens) as cache_read_tokens,
               SUM(cache_write_tokens) as cache_write_tokens,
               SUM(reasoning_tokens) as reasoning_tokens,
               COUNT(*) as session_count
        FROM sessions
        WHERE started_at >= ?
        GROUP BY model
      `).all(monthStart) as AggRow[]

      // Recent sessions (last 20)
      const recentRows = db.prepare(`
        SELECT id, model, started_at, ended_at,
               input_tokens, output_tokens,
               cache_read_tokens, cache_write_tokens,
               reasoning_tokens
        FROM sessions
        ORDER BY started_at DESC
        LIMIT 20
      `).all() as SessionRow[]

      // Compute costs
      let costToday = 0
      let costWeek = 0
      let costMonth = 0
      let totalTokensToday = 0
      let sessionCountToday = 0
      let hasUnknown = false
      let hasEstimated = false

      const byModel = todayRows.map((row) => {
        const pricing = row.model ? lookupPricing(row.model) : null
        const { cost, status } = computeSessionCost(row, pricing)
        if (status === 'unknown') hasUnknown = true
        else hasEstimated = true
        costToday += cost
        totalTokensToday += row.input_tokens + row.output_tokens + row.cache_read_tokens + row.cache_write_tokens + row.reasoning_tokens
        sessionCountToday += row.session_count
        return {
          model: row.model || 'unknown',
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cacheWriteTokens: row.cache_write_tokens,
          reasoningTokens: row.reasoning_tokens,
          cost,
          sessionCount: row.session_count,
          costStatus: status,
        }
      })

      for (const row of weekRows) {
        const pricing = row.model ? lookupPricing(row.model) : null
        const { cost } = computeSessionCost(row, pricing)
        costWeek += cost
      }

      for (const row of monthRows) {
        const pricing = row.model ? lookupPricing(row.model) : null
        const { cost } = computeSessionCost(row, pricing)
        costMonth += cost
      }

      const recentSessions: SessionUsage[] = recentRows.map((row) => {
        const pricing = row.model ? lookupPricing(row.model) : null
        const { cost, status } = computeSessionCost(row, pricing)
        return {
          sessionId: row.id,
          model: row.model || 'unknown',
          startedAt: row.started_at,
          endedAt: row.ended_at,
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          cacheReadTokens: row.cache_read_tokens,
          cacheWriteTokens: row.cache_write_tokens,
          reasoningTokens: row.reasoning_tokens,
          estimatedCostUsd: cost,
          costStatus: status,
        }
      })

      const costStatus: UsageSummary['costStatus'] =
        hasUnknown && hasEstimated ? 'partial' :
        hasUnknown ? 'unknown' : 'estimated'

      return {
        costToday,
        costWeek,
        costMonth,
        totalTokensToday,
        sessionCountToday,
        costStatus,
        byModel,
        recentSessions,
      }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
}
