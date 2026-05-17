// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readModelConfig, readModelProvider } from '../harness'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('readModelConfig', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-config-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty array when config.yaml does not exist', () => {
    expect(readModelConfig(tmpDir)).toEqual([])
  })

  it('parses primary model from config.yaml', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      `model:\n  provider: openrouter\n  default: anthropic/claude-opus-4.7\n`
    )
    const models = readModelConfig(tmpDir)
    expect(models).toContain('anthropic/claude-opus-4.7')
    expect(models[0]).toBe('anthropic/claude-opus-4.7')
  })

  it('parses fallback model when present', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      `model:\n  provider: openrouter\n  default: anthropic/claude-opus-4.7\n  fallback: anthropic/claude-haiku-4.5\n`
    )
    const models = readModelConfig(tmpDir)
    expect(models[0]).toBe('anthropic/claude-opus-4.7')
    expect(models[1]).toBe('anthropic/claude-haiku-4.5')
  })

  it('handles quoted values', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      `model:\n  provider: anthropic\n  default: "claude-opus-4-5"\n`
    )
    const models = readModelConfig(tmpDir)
    expect(models[0]).toBe('claude-opus-4-5')
  })

  it('ignores auxiliary model: lines with empty values', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      `model:\n  provider: openrouter\n  default: anthropic/claude-opus-4.7\n\nauxiliary:\n  vision:\n    provider: auto\n    model: ""\n`
    )
    const models = readModelConfig(tmpDir)
    // Empty model value should not be included
    expect(models).not.toContain('')
    expect(models[0]).toBe('anthropic/claude-opus-4.7')
  })

  it('captures non-empty auxiliary models', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      `model:\n  provider: openrouter\n  default: anthropic/claude-opus-4.7\n\nauxiliary:\n  vision:\n    provider: auto\n    model: google/gemini-2.5-pro\n`
    )
    const models = readModelConfig(tmpDir)
    expect(models).toContain('google/gemini-2.5-pro')
    expect(models[0]).toBe('anthropic/claude-opus-4.7')
  })
})

describe('readModelProvider', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-provider-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns empty string when config.yaml does not exist', () => {
    expect(readModelProvider(tmpDir)).toBe('')
  })

  it('parses provider from config.yaml', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      `model:\n  provider: openrouter\n  default: anthropic/claude-opus-4.7\n`
    )
    expect(readModelProvider(tmpDir)).toBe('openrouter')
  })

  it('handles anthropic provider', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.yaml'),
      `model:\n  provider: anthropic\n  default: claude-opus-4-5\n`
    )
    expect(readModelProvider(tmpDir)).toBe('anthropic')
  })
})
