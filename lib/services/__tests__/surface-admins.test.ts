import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SurfaceAdminService, isValidIdentity, isSupportedSurface } from '../surface-admins'
import { Storage } from '../storage'

// Each test gets an isolated fake $HOME (for agent .env files) and an isolated
// Storage base dir (for harnesses.json). No Docker, no real home touched.
let home: string
let dataDir: string
let storage: Storage
let audit: { append: ReturnType<typeof vi.fn> }
let svc: SurfaceAdminService

function writeAgentEnv(harnessName: string, content: string) {
  const agentDir = harnessName === 'personal'
    ? path.join(home, '.hermes')
    : path.join(home, `.hermes-${harnessName}`)
  fs.mkdirSync(agentDir, { recursive: true })
  fs.writeFileSync(path.join(agentDir, '.env'), content)
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-home-'))
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-data-'))
  vi.spyOn(os, 'homedir').mockReturnValue(home)
  storage = new Storage(dataDir)
  audit = { append: vi.fn() }
  svc = new SurfaceAdminService(storage, audit as never)
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('isValidIdentity', () => {
  it('accepts a Signal UUID and a phone number', () => {
    expect(isValidIdentity('signal', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true)
    expect(isValidIdentity('signal', '+6421234567')).toBe(true)
  })
  it('accepts a Telegram numeric id', () => {
    expect(isValidIdentity('telegram', '123456789')).toBe(true)
    expect(isValidIdentity('telegram', '-1001234567')).toBe(true)
  })
  it('rejects the wildcard, empty, and separator/control chars', () => {
    expect(isValidIdentity('signal', '*')).toBe(false)
    expect(isValidIdentity('signal', '')).toBe(false)
    expect(isValidIdentity('signal', '+64123,+64999')).toBe(false)
    expect(isValidIdentity('telegram', '123\n456')).toBe(false)
    expect(isValidIdentity('telegram', 'KEY=val')).toBe(false)
  })
  it('rejects non-strings and unsupported platforms', () => {
    expect(isValidIdentity('signal', 42 as never)).toBe(false)
    expect(isValidIdentity('whatsapp', '+64123')).toBe(false)
  })
})

describe('isSupportedSurface', () => {
  it('knows the five gateway surfaces and rejects others', () => {
    for (const p of ['signal', 'telegram', 'mattermost', 'discord', 'slack']) {
      expect(isSupportedSurface(p)).toBe(true)
    }
    expect(isSupportedSurface('whatsapp')).toBe(false)
  })
})

describe('SurfaceAdminService.listAdmins — default to allowlist (no regression)', () => {
  it('falls back to the DM allowlist when no explicit list is set', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111,aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n')
    const list = svc.listAdmins('h_seraph', 'signal')
    expect(list.source).toBe('allowlist')
    expect(list.admins).toEqual(['+64111', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'])
    expect(list.allowAllDm).toBe(false)
  })

  it('reports allowAllDm and yields ZERO admins for a wildcard allowlist', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=*\n')
    const list = svc.listAdmins('h_seraph', 'signal')
    expect(list.admins).toEqual([])
    expect(list.allowAllDm).toBe(true)
  })

  it('returns the explicit list (source: explicit) once one is stored', () => {
    storage.write('harnesses.json', [
      { id: 'h_seraph', surfaceAdmins: { signal: ['+64777'] } },
    ])
    const list = svc.listAdmins('h_seraph', 'signal')
    expect(list.source).toBe('explicit')
    expect(list.admins).toEqual(['+64777'])
  })

  it('resolves the personal agent .env at ~/.hermes', () => {
    writeAgentEnv('personal', 'TELEGRAM_ALLOWED_USERS=555\n')
    expect(svc.listAdmins('h_personal', 'telegram').admins).toEqual(['555'])
  })
})

describe('SurfaceAdminService.isAdmin — fail closed', () => {
  it('is true for a user in the bootstrap allowlist', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111,+64222\n')
    expect(svc.isAdmin('h_seraph', 'signal', '+64222')).toBe(true)
  })

  it('is false for a user not in the allowlist', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    expect(svc.isAdmin('h_seraph', 'signal', '+64999')).toBe(false)
  })

  it('is false when the allowlist is a wildcard (allow-all DM ≠ everyone admin)', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=*\n')
    expect(svc.isAdmin('h_seraph', 'signal', '+64999')).toBe(false)
  })

  it('is false for unknown agent, empty userId, and unsupported platform', () => {
    expect(svc.isAdmin('h_ghost', 'signal', '+64111')).toBe(false)
    expect(svc.isAdmin('h_seraph', 'signal', '')).toBe(false)
    expect(svc.isAdmin('h_seraph', 'whatsapp', '+64111')).toBe(false)
  })

  it('honors an explicit list over the allowlist', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    storage.write('harnesses.json', [
      { id: 'h_seraph', surfaceAdmins: { signal: ['+64222'] } },
    ])
    // +64111 was a bootstrap admin but the explicit list replaces it.
    expect(svc.isAdmin('h_seraph', 'signal', '+64111')).toBe(false)
    expect(svc.isAdmin('h_seraph', 'signal', '+64222')).toBe(true)
  })
})

describe('SurfaceAdminService.setAdmins — authz + validation', () => {
  it('lets a bootstrap admin set the explicit list, and persists it', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    const res = svc.setAdmins('h_seraph', 'signal', ['+64222', '+64333'], '+64111')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.admins).toEqual(['+64222', '+64333'])
    const stored = storage.read<Array<{ id: string; surfaceAdmins?: Record<string, string[]> }>>('harnesses.json', [])
    expect(stored.find((h) => h.id === 'h_seraph')?.surfaceAdmins?.signal).toEqual(['+64222', '+64333'])
    expect(audit.append).toHaveBeenCalledWith(
      expect.objectContaining({ who: '+64111', what: 'surface-admins:set:signal', target: 'h_seraph' }),
    )
  })

  it('rejects a non-admin actor with 403 (no self-escalation) and does not write', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    const res = svc.setAdmins('h_seraph', 'signal', ['+64999'], '+64999')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(403)
    expect(storage.read('harnesses.json', [])).toEqual([])
    expect(audit.append).not.toHaveBeenCalled()
  })

  it('rejects malformed identities with 400', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    const res = svc.setAdmins('h_seraph', 'signal', ['+64222', 'not,valid'], '+64111')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(400)
  })

  it('rejects a non-array body and a missing actor with 400', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    expect(svc.setAdmins('h_seraph', 'signal', 'nope' as never, '+64111')).toMatchObject({ ok: false, status: 400 })
    expect(svc.setAdmins('h_seraph', 'signal', ['+64222'], '')).toMatchObject({ ok: false, status: 400 })
  })

  it('rejects an unsupported platform with 400', () => {
    expect(svc.setAdmins('h_seraph', 'whatsapp', ['+64222'], '+64111')).toMatchObject({ ok: false, status: 400 })
  })

  it('dedupes identities before persisting', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    const res = svc.setAdmins('h_seraph', 'signal', ['+64222', '+64222'], '+64111')
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.admins).toEqual(['+64222'])
  })

  it('an actor promoted into the explicit list can then manage it', () => {
    writeAgentEnv('seraph', 'SIGNAL_ALLOWED_USERS=+64111\n')
    // Bootstrap admin adds +64222.
    svc.setAdmins('h_seraph', 'signal', ['+64111', '+64222'], '+64111')
    // Now +64222 (in the explicit list) can mutate; +64111 still can too.
    const res = svc.setAdmins('h_seraph', 'signal', ['+64222'], '+64222')
    expect(res.ok).toBe(true)
    // And the former bootstrap admin, now removed, can no longer mutate.
    const res2 = svc.setAdmins('h_seraph', 'signal', ['+64111'], '+64111')
    expect(res2.ok).toBe(false)
    if (!res2.ok) expect(res2.status).toBe(403)
  })
})

describe('SurfaceAdminService.isGroupAllowed', () => {
  it('is true for a listed group and for a wildcard', () => {
    writeAgentEnv('seraph', 'SIGNAL_GROUP_ALLOWED_USERS=g1,g2\n')
    expect(svc.isGroupAllowed('h_seraph', 'signal', 'g2')).toBe(true)
    writeAgentEnv('wild', 'TELEGRAM_GROUP_ALLOWED_CHATS=*\n')
    expect(svc.isGroupAllowed('h_wild', 'telegram', '-100')).toBe(true)
  })
  it('fails closed for unlisted group, unknown agent, unsupported platform', () => {
    writeAgentEnv('seraph', 'SIGNAL_GROUP_ALLOWED_USERS=g1\n')
    expect(svc.isGroupAllowed('h_seraph', 'signal', 'gX')).toBe(false)
    expect(svc.isGroupAllowed('h_ghost', 'signal', 'g1')).toBe(false)
    expect(svc.isGroupAllowed('h_seraph', 'whatsapp', 'g1')).toBe(false)
  })
})
