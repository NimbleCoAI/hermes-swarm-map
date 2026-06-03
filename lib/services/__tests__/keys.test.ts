import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { KeysService, anthropicEnvVarForValue } from '../keys'
import { Storage } from '../storage'
import { AuditService } from '../audit'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('KeysService', () => {
  let tmpDir: string
  let keys: KeysService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-keys-'))
    const storage = new Storage(tmpDir)
    const audit = new AuditService(storage)
    keys = new KeysService(storage, audit)
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // Pass [] as harnessNames so discovery is skipped (no real agent dirs in test env)
  it('starts with empty list', () => {
    expect(keys.list([])).toEqual([])
  })

  it('adds a key and masks the value', () => {
    const key = keys.add({ provider: 'anthropic', value: 'sk-ant-12345678' })
    expect(key.provider).toBe('anthropic')
    expect(key.maskedValue).toBe('sk-a…5678')
    expect(key.health).toBe('good')
  })

  it('lists keys with masked values', () => {
    keys.add({ provider: 'anthropic', value: 'sk-ant-12345678' })
    keys.add({ provider: 'openai', value: 'sk-proj-abcdefgh' })
    const list = keys.list([])
    expect(list).toHaveLength(2)
    expect(JSON.stringify(list)).not.toContain('sk-ant-12345678')
    expect(JSON.stringify(list)).not.toContain('sk-proj-abcdefgh')
  })

  it('removes a key', () => {
    const key = keys.add({ provider: 'test', value: 'test-key-value' })
    keys.remove(key.id)
    expect(keys.list([])).toHaveLength(0)
  })

  it('updates key assignment', () => {
    const key = keys.add({ provider: 'test', value: 'test-key' })
    keys.update(key.id, { assignedTo: ['h_audrey', 'h_cryptid'] })
    const updated = keys.list([]).find((k) => k.id === key.id)
    expect(updated!.assignedTo).toEqual(['h_audrey', 'h_cryptid'])
  })
})

// Anthropic accepts two credential formats that require different auth headers:
// standard API keys (sk-ant-api*) authenticate via x-api-key (ANTHROPIC_API_KEY),
// while Bearer-style tokens (sk-ant-oat*, cc-*, JWT eyJ*) must be supplied via
// ANTHROPIC_TOKEN so the client sends Authorization: Bearer — and NOT via
// ANTHROPIC_API_KEY, or the SDK attaches a conflicting x-api-key header too.
describe('anthropicEnvVarForValue', () => {
  it('routes standard API keys to ANTHROPIC_API_KEY', () => {
    expect(anthropicEnvVarForValue('sk-ant-api03-ABCdef')).toBe('ANTHROPIC_API_KEY')
  })
  it('routes setup tokens to ANTHROPIC_TOKEN', () => {
    expect(anthropicEnvVarForValue('sk-ant-oat01-ABCdef')).toBe('ANTHROPIC_TOKEN')
  })
  it('routes cc- access tokens to ANTHROPIC_TOKEN', () => {
    expect(anthropicEnvVarForValue('cc-abcdef')).toBe('ANTHROPIC_TOKEN')
  })
  it('routes JWT (eyJ) tokens to ANTHROPIC_TOKEN', () => {
    expect(anthropicEnvVarForValue('eyJhbG.payload.sig')).toBe('ANTHROPIC_TOKEN')
  })
  it('defaults unknown shapes to ANTHROPIC_API_KEY', () => {
    expect(anthropicEnvVarForValue('whatever')).toBe('ANTHROPIC_API_KEY')
  })
})

describe('anthropic credential env-var routing (writeKeyToEnv/removeKeyFromEnv)', () => {
  let tmpHome: string
  let prevHome: string | undefined
  let keys: KeysService

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-home-'))
    prevHome = process.env.HOME
    process.env.HOME = tmpHome
    const storage = new Storage(fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-store-')))
    keys = new KeysService(storage, new AuditService(storage))
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME
    else process.env.HOME = prevHome
    fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  const envFor = (name: string) => path.join(tmpHome, `.hermes-${name}`, '.env')
  const read = (name: string) => fs.readFileSync(envFor(name), 'utf-8')

  it('writes an OAuth-shaped token to ANTHROPIC_TOKEN, not ANTHROPIC_API_KEY', () => {
    keys.writeKeyToEnv('agentA', 'anthropic', 'sk-ant-oat01-SECRET')
    const env = read('agentA')
    expect(env).toMatch(/^ANTHROPIC_TOKEN=sk-ant-oat01-SECRET$/m)
    expect(env).not.toMatch(/^ANTHROPIC_API_KEY=/m)
  })

  it('writes a standard API key to ANTHROPIC_API_KEY, not ANTHROPIC_TOKEN', () => {
    keys.writeKeyToEnv('agentB', 'anthropic', 'sk-ant-api03-SECRET')
    const env = read('agentB')
    expect(env).toMatch(/^ANTHROPIC_API_KEY=sk-ant-api03-SECRET$/m)
    expect(env).not.toMatch(/^ANTHROPIC_TOKEN=/m)
  })

  it('clears the stale API key when switching to an OAuth token (no dual auth header)', () => {
    keys.writeKeyToEnv('agentC', 'anthropic', 'sk-ant-api03-OLD')
    keys.writeKeyToEnv('agentC', 'anthropic', 'sk-ant-oat01-NEW')
    const env = read('agentC')
    expect(env).toMatch(/^ANTHROPIC_TOKEN=sk-ant-oat01-NEW$/m)
    expect(env).not.toMatch(/^ANTHROPIC_API_KEY=/m)
  })

  it('clears the stale token when switching back to an API key', () => {
    keys.writeKeyToEnv('agentC2', 'anthropic', 'sk-ant-oat01-OLD')
    keys.writeKeyToEnv('agentC2', 'anthropic', 'sk-ant-api03-NEW')
    const env = read('agentC2')
    expect(env).toMatch(/^ANTHROPIC_API_KEY=sk-ant-api03-NEW$/m)
    expect(env).not.toMatch(/^ANTHROPIC_TOKEN=/m)
  })

  it('removeKeyFromEnv clears both anthropic vars', () => {
    keys.writeKeyToEnv('agentD', 'anthropic', 'sk-ant-oat01-X')
    keys.removeKeyFromEnv('agentD', 'anthropic')
    const env = read('agentD')
    expect(env).not.toMatch(/^ANTHROPIC_(TOKEN|API_KEY)=/m)
  })

  it('preserves unrelated env vars when routing anthropic creds', () => {
    fs.mkdirSync(path.join(tmpHome, '.hermes-agentE'), { recursive: true })
    fs.writeFileSync(envFor('agentE'), 'TELEGRAM_BOT_TOKEN=abc\nANTHROPIC_API_KEY=sk-ant-api03-OLD\n')
    keys.writeKeyToEnv('agentE', 'anthropic', 'sk-ant-oat01-NEW')
    const env = read('agentE')
    expect(env).toMatch(/^TELEGRAM_BOT_TOKEN=abc$/m)
    expect(env).toMatch(/^ANTHROPIC_TOKEN=sk-ant-oat01-NEW$/m)
    expect(env).not.toMatch(/^ANTHROPIC_API_KEY=/m)
  })

  it('leaves non-anthropic providers on their normal var', () => {
    keys.writeKeyToEnv('agentF', 'openai', 'sk-proj-XYZ')
    expect(read('agentF')).toMatch(/^OPENAI_API_KEY=sk-proj-XYZ$/m)
  })
})
