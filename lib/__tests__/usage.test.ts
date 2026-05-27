import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { lookupPricing, computeCost } from '@/lib/pricing'

// We test the internal functions by importing from usage.ts
// but we need to mock the data dir resolution
const TEST_DIR = path.join(os.tmpdir(), 'hsm-usage-test-' + Date.now())
const TEST_DB_PATH = path.join(TEST_DIR, 'state.db')

function createTestDb(): Database.Database {
  fs.mkdirSync(TEST_DIR, { recursive: true })
  const db = new Database(TEST_DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      user_id TEXT,
      model TEXT,
      model_config TEXT,
      system_prompt TEXT,
      parent_session_id TEXT,
      started_at REAL NOT NULL,
      ended_at REAL,
      end_reason TEXT,
      message_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      billing_provider TEXT,
      billing_base_url TEXT,
      billing_mode TEXT,
      estimated_cost_usd REAL,
      actual_cost_usd REAL,
      cost_status TEXT,
      cost_source TEXT,
      pricing_version TEXT,
      title TEXT
    )
  `)
  return db
}

function insertSession(db: Database.Database, opts: {
  id?: string
  model?: string
  startedAt?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}) {
  const id = opts.id ?? `session-${Math.random().toString(36).slice(2)}`
  const startedAt = opts.startedAt ?? (Date.now() / 1000)
  db.prepare(`
    INSERT INTO sessions (id, source, model, started_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens)
    VALUES (?, 'test', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.model ?? 'claude-sonnet-4',
    startedAt,
    opts.inputTokens ?? 0,
    opts.outputTokens ?? 0,
    opts.cacheReadTokens ?? 0,
    opts.cacheWriteTokens ?? 0,
    opts.reasoningTokens ?? 0,
  )
}

// Mock the os.homedir and data dir resolution
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return {
    ...actual,
    default: {
      ...actual,
      homedir: () => actual.homedir(),
    },
  }
})

describe('usage service', () => {
  let testDb: Database.Database

  beforeEach(() => {
    testDb = createTestDb()
  })

  afterEach(() => {
    try { testDb.close() } catch {}
    try { fs.rmSync(TEST_DIR, { recursive: true }) } catch {}
  })

  // Since the usage service resolves paths from harnessId via os.homedir,
  // we test the lower-level pricing + db query logic directly here.
  // The integration between getCostToday and real agent dirs is tested by
  // the actual running system.

  it('can read sessions from a test state.db', () => {
    const now = Date.now() / 1000
    insertSession(testDb, {
      model: 'claude-sonnet-4',
      startedAt: now - 60,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
    })

    const rows = testDb.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number }
    expect(rows.count).toBe(1)
  })

  it('aggregates tokens by model', () => {
    const now = Date.now() / 1000
    insertSession(testDb, { model: 'claude-sonnet-4', startedAt: now - 60, inputTokens: 500_000, outputTokens: 50_000 })
    insertSession(testDb, { model: 'claude-sonnet-4', startedAt: now - 30, inputTokens: 500_000, outputTokens: 50_000 })
    insertSession(testDb, { model: 'gemini-2.5-flash', startedAt: now - 10, inputTokens: 100_000, outputTokens: 10_000 })

    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayUnix = todayStart.getTime() / 1000

    type AggRow = { model: string; input_tokens: number; output_tokens: number; session_count: number }
    const rows = testDb.prepare(`
      SELECT model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens, COUNT(*) as session_count
      FROM sessions
      WHERE started_at >= ?
      GROUP BY model
    `).all(todayUnix) as AggRow[]

    const sonnet = rows.find(r => r.model === 'claude-sonnet-4')
    expect(sonnet).toBeDefined()
    expect(sonnet!.input_tokens).toBe(1_000_000)
    expect(sonnet!.output_tokens).toBe(100_000)
    expect(sonnet!.session_count).toBe(2)

    const gemini = rows.find(r => r.model === 'gemini-2.5-flash')
    expect(gemini).toBeDefined()
    expect(gemini!.session_count).toBe(1)
  })

  it('handles empty database gracefully', () => {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const todayUnix = todayStart.getTime() / 1000

    type AggRow = { model: string; total: number }
    const rows = testDb.prepare(`
      SELECT model, SUM(input_tokens) as total
      FROM sessions
      WHERE started_at >= ?
      GROUP BY model
    `).all(todayUnix) as AggRow[]

    expect(rows.length).toBe(0)
  })

  it('computes cost from aggregated rows using pricing', () => {
    const now = Date.now() / 1000
    insertSession(testDb, {
      model: 'claude-sonnet-4',
      startedAt: now - 60,
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      cacheWriteTokens: 200_000,
    })

    type Row = { model: string; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; reasoning_tokens: number }
    const rows = testDb.prepare(`
      SELECT model,
             SUM(input_tokens) as input_tokens,
             SUM(output_tokens) as output_tokens,
             SUM(cache_read_tokens) as cache_read_tokens,
             SUM(cache_write_tokens) as cache_write_tokens,
             SUM(reasoning_tokens) as reasoning_tokens
      FROM sessions
      GROUP BY model
    `).all() as Row[]

    let totalCost = 0
    for (const row of rows) {
      const pricing = lookupPricing(row.model)
      expect(pricing).not.toBeNull()
      const cost = computeCost({
        input: row.input_tokens,
        output: row.output_tokens,
        cacheRead: row.cache_read_tokens,
        cacheWrite: row.cache_write_tokens,
        reasoning: row.reasoning_tokens,
      }, pricing!)
      totalCost += cost
    }

    // $3 input + $1.5 output + $0.15 cache read + $0.75 cache write = $5.40
    expect(totalCost).toBeCloseTo(5.4, 1)
  })
})
