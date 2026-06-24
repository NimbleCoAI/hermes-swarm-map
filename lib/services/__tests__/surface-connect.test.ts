import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// We test the env-merging logic directly since route handlers need Next.js runtime.
// Extract the logic into a helper and test that.
import { mergeEnvVars, buildConnectEnvVars, ensurePolicyDefaults, buildSettingsEnvValue } from '../../env-helpers'

describe('surface connect env merging', () => {
  let tmpDir: string
  let envPath: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-connect-'))
    envPath = path.join(tmpDir, '.env')
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('preserves existing SIGNAL_ALLOWED_USERS when connecting signal surface', () => {
    // User previously set allowed users via settings
    fs.writeFileSync(envPath, [
      'ANTHROPIC_API_KEY=sk-test',
      'SIGNAL_ALLOWED_USERS=+15551234567,+15559876543',
      'SIGNAL_GROUP_ALLOWED_USERS=group1,group2',
      'SIGNAL_HTTP_URL=http://old-url:8080',
      'SIGNAL_ACCOUNT=+15550000000',
    ].join('\n'))

    const connectVars = buildConnectEnvVars('signal', {
      url: 'http://host.docker.internal:8080',
      phone: '+15551112222',
    })

    const content = fs.readFileSync(envPath, 'utf-8')
    const result = mergeEnvVars(content, connectVars)

    // Connection vars should update
    expect(result).toContain('SIGNAL_HTTP_URL=http://host.docker.internal:8080')
    expect(result).toContain('SIGNAL_ACCOUNT=+15551112222')

    // Policy vars should be PRESERVED (not overwritten)
    expect(result).toContain('SIGNAL_ALLOWED_USERS=+15551234567,+15559876543')
    expect(result).toContain('SIGNAL_GROUP_ALLOWED_USERS=group1,group2')
  })

  it('sets empty ALLOWED_USERS for new signal connection (secure default)', () => {
    fs.writeFileSync(envPath, [
      'ANTHROPIC_API_KEY=sk-test',
    ].join('\n'))

    const connectVars = buildConnectEnvVars('signal', {
      url: 'http://host.docker.internal:8080',
      phone: '+15551112222',
    })

    const content = fs.readFileSync(envPath, 'utf-8')
    let result = mergeEnvVars(content, connectVars)
    result = ensurePolicyDefaults(result, 'signal')

    // New connection should get empty allowed users (approved-only default)
    expect(result).toContain('SIGNAL_ALLOWED_USERS=')
    expect(result).not.toContain('SIGNAL_ALLOWED_USERS=*')
  })

  it('preserves existing TELEGRAM_ALLOWED_USERS when connecting telegram', () => {
    fs.writeFileSync(envPath, [
      'ANTHROPIC_API_KEY=sk-test',
      'TELEGRAM_BOT_TOKEN=old-token',
      'TELEGRAM_ALLOWED_USERS=12345,67890',
    ].join('\n'))

    const connectVars = buildConnectEnvVars('telegram', {
      token: 'new-bot-token-123',
    })

    const content = fs.readFileSync(envPath, 'utf-8')
    const result = mergeEnvVars(content, connectVars)

    // Token should update
    expect(result).toContain('TELEGRAM_BOT_TOKEN=new-bot-token-123')

    // Policy should be preserved
    expect(result).toContain('TELEGRAM_ALLOWED_USERS=12345,67890')
  })

  it('preserves existing MATTERMOST policy vars when reconnecting', () => {
    fs.writeFileSync(envPath, [
      'MATTERMOST_URL=http://old.mm.local',
      'MATTERMOST_TOKEN=old-token',
      'MATTERMOST_ALLOWED_USERS=admin,user1',
      'MATTERMOST_ALLOWED_CHANNELS=general,random',
    ].join('\n'))

    const connectVars = buildConnectEnvVars('mattermost', {
      url: 'http://new.mm.local',
      token: 'new-token',
    })

    const content = fs.readFileSync(envPath, 'utf-8')
    const result = mergeEnvVars(content, connectVars)

    expect(result).toContain('MATTERMOST_URL=http://new.mm.local')
    expect(result).toContain('MATTERMOST_TOKEN=new-token')
    expect(result).toContain('MATTERMOST_ALLOWED_USERS=admin,user1')
    expect(result).toContain('MATTERMOST_ALLOWED_CHANNELS=general,random')
  })

  it('preserves existing DISCORD policy vars when reconnecting', () => {
    fs.writeFileSync(envPath, [
      'DISCORD_BOT_TOKEN=old-token',
      'DISCORD_ALLOWED_USERS=111,222',
      'DISCORD_ALLOWED_CHANNELS=chan1,chan2',
    ].join('\n'))

    const connectVars = buildConnectEnvVars('discord', { token: 'new-token' })

    const content = fs.readFileSync(envPath, 'utf-8')
    const result = mergeEnvVars(content, connectVars)

    // Token updates; the user/channel allowlists are preserved.
    expect(result).toContain('DISCORD_BOT_TOKEN=new-token')
    expect(result).toContain('DISCORD_ALLOWED_USERS=111,222')
    expect(result).toContain('DISCORD_ALLOWED_CHANNELS=chan1,chan2')
  })

  describe('buildConnectEnvVars', () => {
    it('only returns connection vars, not policy vars, for signal', () => {
      const vars = buildConnectEnvVars('signal', {
        url: 'http://host.docker.internal:8080',
        phone: '+15551112222',
      })

      expect(vars).toHaveProperty('SIGNAL_HTTP_URL')
      expect(vars).toHaveProperty('SIGNAL_ACCOUNT')
      expect(vars).not.toHaveProperty('SIGNAL_ALLOWED_USERS')
      expect(vars).not.toHaveProperty('SIGNAL_GROUP_ALLOWED_USERS')
    })

    it('only returns connection vars for telegram', () => {
      const vars = buildConnectEnvVars('telegram', { token: 'abc' })

      expect(vars).toHaveProperty('TELEGRAM_BOT_TOKEN')
      expect(vars).not.toHaveProperty('TELEGRAM_ALLOWED_USERS')
      expect(vars).not.toHaveProperty('TELEGRAM_GROUP_ALLOWED_CHATS')
    })

    it('only returns connection vars for mattermost', () => {
      const vars = buildConnectEnvVars('mattermost', { url: 'http://mm', token: 'tok' })

      expect(vars).toHaveProperty('MATTERMOST_URL')
      expect(vars).toHaveProperty('MATTERMOST_TOKEN')
      expect(vars).not.toHaveProperty('MATTERMOST_ALLOWED_USERS')
      expect(vars).not.toHaveProperty('MATTERMOST_ALLOWED_CHANNELS')
    })

    it('only returns the bot token for discord, not policy vars', () => {
      const vars = buildConnectEnvVars('discord', { token: 'bot.token.xyz' })

      expect(vars).toHaveProperty('DISCORD_BOT_TOKEN')
      expect(vars).not.toHaveProperty('DISCORD_ALLOWED_USERS')
      expect(vars).not.toHaveProperty('DISCORD_ALLOWED_CHANNELS')
    })
  })

  describe('mergeEnvVars', () => {
    it('updates existing keys', () => {
      const content = 'FOO=old\nBAR=keep\n'
      const result = mergeEnvVars(content, { FOO: 'new' })
      expect(result).toContain('FOO=new')
      expect(result).toContain('BAR=keep')
    })

    it('appends new keys', () => {
      const content = 'FOO=old\n'
      const result = mergeEnvVars(content, { BAR: 'new' })
      expect(result).toContain('FOO=old')
      expect(result).toContain('BAR=new')
    })
  })
})

describe('settings PUT defaults', () => {
  // Test that approved-only with empty user list writes empty string, not *
  it('approved-only with no users should write empty string, not wildcard', () => {
    // approved-only + empty user list = empty string (no one allowed until explicitly added)
    expect(buildSettingsEnvValue('approved-only', false, [])).toBe('')

    // allow-all = *
    expect(buildSettingsEnvValue('allow-all', false, [])).toBe('*')

    // approved-only with specific users = comma-joined
    expect(buildSettingsEnvValue('approved-only', false, ['user1', 'user2'])).toBe('user1,user2')

    // per-surface allowAll override
    expect(buildSettingsEnvValue('approved-only', true, [])).toBe('*')
  })
})
