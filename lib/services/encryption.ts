import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32  // 256 bits
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

// Machine-local key: derived from a file at {dataDir}/.key
// Created once on first use, never committed to git
function getMasterKey(dataDir: string): Buffer {
  const keyPath = path.join(dataDir, '.key')

  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath, 'utf-8').trim()
    return Buffer.from(raw, 'hex')
  }

  // Generate a new random key
  const key = crypto.randomBytes(KEY_LENGTH)
  fs.mkdirSync(path.dirname(keyPath), { recursive: true })
  fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 })
  return key
}

export class Encryption {
  private key: Buffer

  constructor(dataDir: string) {
    this.key = getMasterKey(dataDir)
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH)
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
    const authTag = cipher.getAuthTag()
    // Format: iv:authTag:ciphertext (all hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
  }

  decrypt(encryptedStr: string): string {
    const [ivHex, authTagHex, ciphertextHex] = encryptedStr.split(':')
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Invalid encrypted format')
    }
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const ciphertext = Buffer.from(ciphertextHex, 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(ciphertext).toString('utf-8') + decipher.final('utf-8')
  }
}

// Suppress unused import warning for AUTH_TAG_LENGTH (kept for documentation)
void AUTH_TAG_LENGTH
