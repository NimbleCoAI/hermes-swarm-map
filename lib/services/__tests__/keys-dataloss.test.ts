// @vitest-environment node
//
// Two correctness/data-integrity findings in KeysService:
//   D5 — getDecryptedValue returned the raw `iv:tag:ciphertext` string when
//        decryption failed (rotated/lost .key), handing a garbage credential to
//        the agent instead of failing loud.
//   D2 — key discovery only scanned a hardcoded 8-name list, so harnesses
//        created via the app's own Create/Duplicate/Import UI (persisted in
//        harnesses.json) showed zero keys permanently.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { KeysService } from '../keys'
import { Storage } from '../storage'
import { AuditService } from '../audit'
import { Encryption } from '../encryption'
import fs from 'fs'
import path from 'path'
import os from 'os'

describe('KeysService — data-integrity fixes', () => {
  let tmpDir: string
  let keys: KeysService

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-keys-dl-'))
    const storage = new Storage(tmpDir)
    keys = new KeysService(storage, new AuditService(storage), tmpDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('getDecryptedValue on decrypt failure (D5)', () => {
    it('returns undefined — NOT the raw ciphertext — when the key cannot be decrypted', () => {
      vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
      // A ciphertext encrypted under a DIFFERENT master key (simulates a rotated
      // or lost .key). Decryption under the current key will fail.
      const foreignDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-map-foreign-'))
      const foreignCiphertext = new Encryption(foreignDir).encrypt('sk-ant-real-secret')
      new Storage(tmpDir).write('keys.json', [
        { id: 'k_rot', provider: 'anthropic', name: 'x', encryptedValue: foreignCiphertext, assignedTo: [] },
      ])

      const val = keys.getDecryptedValue('k_rot')
      expect(val).toBeUndefined()
      expect(val).not.toBe(foreignCiphertext)
      fs.rmSync(foreignDir, { recursive: true, force: true })
    })

    it('still returns a legacy plaintext value stored before encryption existed', () => {
      vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
      // A pre-encryption value has no iv:tag:ciphertext shape — returning it as-is
      // is correct, and must not be broken by the D5 fix.
      new Storage(tmpDir).write('keys.json', [
        { id: 'k_plain', provider: 'anthropic', name: 'x', encryptedValue: 'sk-ant-legacy-plaintext', assignedTo: [] },
      ])
      expect(keys.getDecryptedValue('k_plain')).toBe('sk-ant-legacy-plaintext')
    })
  })

  describe('key discovery for UI-created harnesses (D2)', () => {
    it('discovers keys for a harness registered in harnesses.json, not just the hardcoded list', () => {
      vi.spyOn(os, 'homedir').mockReturnValue(tmpDir)
      // A harness created through the app — absent from the hardcoded 8-name list.
      new Storage(tmpDir).write('harnesses.json', [{ id: 'h_my_new_agent', name: 'my-new-agent' }])
      // Its .env carries an API key.
      const dir = path.join(tmpDir, '.hermes-my-new-agent')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, '.env'), 'ANTHROPIC_API_KEY=sk-ant-mynew123\n')

      const found = keys.list().some((k) => (k.assignedTo ?? []).includes('h_my_new_agent'))
      expect(found).toBe(true)
    })
  })
})
