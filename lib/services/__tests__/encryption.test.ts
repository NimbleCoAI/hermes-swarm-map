// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { Encryption } from '../encryption'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('Encryption', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-enc-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('encrypts and decrypts a value', () => {
    const enc = new Encryption(tmpDir)
    const plaintext = 'sk-ant-my-secret-key-12345'
    const encrypted = enc.encrypt(plaintext)
    expect(encrypted).not.toBe(plaintext)
    expect(encrypted).toContain(':')
    const decrypted = enc.decrypt(encrypted)
    expect(decrypted).toBe(plaintext)
  })

  it('generates different ciphertext for same input (random IV)', () => {
    const enc = new Encryption(tmpDir)
    const a = enc.encrypt('hello')
    const b = enc.encrypt('hello')
    expect(a).not.toBe(b)
  })

  it('persists key file and reuses it', () => {
    const enc1 = new Encryption(tmpDir)
    const encrypted = enc1.encrypt('test')
    const enc2 = new Encryption(tmpDir)
    const decrypted = enc2.decrypt(encrypted)
    expect(decrypted).toBe('test')
  })

  it('fails to decrypt with wrong key', () => {
    const enc1 = new Encryption(tmpDir)
    const encrypted = enc1.encrypt('secret')
    // Create a different key dir
    const tmpDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-enc2-'))
    const enc2 = new Encryption(tmpDir2)
    expect(() => enc2.decrypt(encrypted)).toThrow()
    fs.rmSync(tmpDir2, { recursive: true, force: true })
  })

  it('key file has restricted permissions', () => {
    new Encryption(tmpDir)
    const keyPath = path.join(tmpDir, '.key')
    const stats = fs.statSync(keyPath)
    // 0o600 = owner read/write only
    expect(stats.mode & 0o777).toBe(0o600)
  })
})
