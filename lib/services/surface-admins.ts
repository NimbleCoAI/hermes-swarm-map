import fs from 'fs'
import path from 'path'
import os from 'os'
import type { Harness } from '@/lib/types'
import type { Storage } from './storage'
import type { AuditService } from './audit'

const HARNESSES_FILE = 'harnesses.json'

// Per-platform DM-allowlist env var. This is the BOOTSTRAP admin set: when a
// surface has no explicit admin list, its admins default to whoever is in the
// DM allowlist (the "_is_approval_admin" / approved-user convention). Keeping
// this as the default is what guarantees no regression — an agent with no role
// config behaves exactly as it did before this store existed.
const ALLOWED_USERS_VARS: Record<string, string> = {
  signal: 'SIGNAL_ALLOWED_USERS',
  telegram: 'TELEGRAM_ALLOWED_USERS',
  mattermost: 'MATTERMOST_ALLOWED_USERS',
  discord: 'DISCORD_ALLOWED_USERS',
  slack: 'SLACK_ALLOWED_USERS',
}

export const SUPPORTED_SURFACES = Object.keys(ALLOWED_USERS_VARS)

export function isSupportedSurface(platform: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_USERS_VARS, platform)
}

// Resolve an agent's data dir from its harness id — same convention the settings
// and policy routes use (hermes-personal lives at ~/.hermes, others at
// ~/.hermes-<name>).
export function agentDataDir(harnessId: string): string {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  if (name === 'personal') return path.join(os.homedir(), '.hermes')
  return path.join(os.homedir(), `.hermes-${name}`)
}

// Validate a native identity key before it enters the store. This is auth
// surface: reject anything that could break comma-list matching, inject into
// storage, or smuggle control characters. We do NOT accept '*' as an admin
// identity — a wildcard admin is never a legitimate explicit entry.
export function isValidIdentity(platform: string, raw: unknown): boolean {
  if (typeof raw !== 'string') return false
  const id = raw.trim()
  if (!id || id.length > 128) return false
  // Structural: no separators/whitespace/control chars that would corrupt the
  // stored list or the exact-match compare the plugin performs.
  if (/[\s,;=\n\r\t]/.test(id)) return false
  if (id === '*') return false
  switch (platform) {
    case 'signal':
      // Phone (+64…) or a Signal UUID.
      return /^\+?[0-9]{5,20}$/.test(id) ||
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id)
    case 'telegram':
      // Numeric user id (Telegram ids are positive; groups negative).
      return /^-?[0-9]{1,20}$/.test(id)
    case 'mattermost':
      // 26-char base32-ish id.
      return /^[a-z0-9]{26}$/.test(id)
    case 'discord':
      // Snowflake.
      return /^[0-9]{5,25}$/.test(id)
    case 'slack':
      // User id like U012ABCDEF.
      return /^[UW][A-Z0-9]{6,20}$/.test(id)
    default:
      return false
  }
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
  return value.split(',').map((s) => s.trim()).filter(Boolean)
}

export type AdminSource = 'explicit' | 'allowlist'

export type AdminList = {
  platform: string
  admins: string[]
  source: AdminSource
  // True when the DM allowlist is a wildcard ('*'). A wildcard means "anyone may
  // DM me", NOT "everyone is an admin" — so it yields ZERO default admins
  // (fail-closed). Surfaced so the UI can explain why the admin set is empty.
  allowAllDm: boolean
}

/**
 * Per-harness, per-surface admin/role store — the policy plane the
 * swarm_map_policy plugin already queries but that had no server side (its
 * GET .../admins/{user_id} route 404'd, failing is_admin closed for everyone).
 *
 * Explicit admin lists live on the harness overlay (harnesses.json) so they are
 * HSM-side policy served live — no container recreate. When a surface has no
 * explicit list, admins default to that surface's DM allowlist read from the
 * agent .env (no regression).
 *
 * Security posture:
 * - isAdmin fails closed: unknown user / unreadable store / unsupported surface
 *   / wildcard allowlist → NOT admin.
 * - Mutations are transport-gated: root middleware.ts (PR #139) requires a
 *   valid operator-session cookie on every PUT/POST/PATCH/DELETE, and agent
 *   containers cannot obtain that cookie. That is the security boundary.
 * - setAdmins additionally checks `actor` against the CURRENT admin set
 *   (explicit, or bootstrap = DM allowlist). This is defense-in-depth plus
 *   semantic authz — it records/verifies WHICH surface identity performed the
 *   change and still blocks self-escalation if the transport gate is ever
 *   disabled (kill-switch) — and identities are validated before they enter
 *   the store.
 */
export class SurfaceAdminService {
  constructor(
    private storage: Storage,
    private audit?: AuditService,
  ) {}

  // Read the raw persisted overlays directly (NOT via HarnessService.list(),
  // which shells out to Docker discovery — far too heavy for the per-message
  // is-admin hot path).
  private readOverlays(): Partial<Harness>[] {
    return this.storage.read<Partial<Harness>[]>(HARNESSES_FILE, [])
  }

  private explicitAdmins(harnessId: string, platform: string): string[] | undefined {
    const overlay = this.readOverlays().find((h) => h.id === harnessId)
    const list = overlay?.surfaceAdmins?.[platform]
    return Array.isArray(list) ? list : undefined
  }

  // The bootstrap admin set: the surface's DM allowlist from the agent .env.
  private allowlistAdmins(harnessId: string, platform: string): { admins: string[]; allowAllDm: boolean } {
    const varName = ALLOWED_USERS_VARS[platform]
    if (!varName) return { admins: [], allowAllDm: false }
    const env = parseEnvFile(path.join(agentDataDir(harnessId), '.env'))
    const raw = env[varName]
    if (raw === '*') return { admins: [], allowAllDm: true }
    return { admins: parseCommaList(raw), allowAllDm: false }
  }

  /**
   * Resolve the effective admin list for a surface: the explicit list if one is
   * set, otherwise the DM-allowlist bootstrap set.
   */
  listAdmins(harnessId: string, platform: string): AdminList {
    if (!isSupportedSurface(platform)) {
      return { platform, admins: [], source: 'allowlist', allowAllDm: false }
    }
    const explicit = this.explicitAdmins(harnessId, platform)
    if (explicit !== undefined) {
      return { platform, admins: [...explicit], source: 'explicit', allowAllDm: false }
    }
    const { admins, allowAllDm } = this.allowlistAdmins(harnessId, platform)
    return { platform, admins, source: 'allowlist', allowAllDm }
  }

  /**
   * Is `userId` an admin on `platform` for this harness? Fail-closed on every
   * unknown/malformed/unsupported input. A wildcard DM allowlist does NOT make
   * everyone an admin.
   */
  isAdmin(harnessId: string, platform: string, userId: string): boolean {
    if (!harnessId || !platform || !userId) return false
    if (!isSupportedSurface(platform)) return false
    const target = userId.trim()
    if (!target) return false
    try {
      return this.listAdmins(harnessId, platform).admins.includes(target)
    } catch {
      return false
    }
  }

  /**
   * Replace the explicit admin list for a surface.
   *
   * Transport authorization happens BEFORE this code runs: the operator-cookie
   * middleware (middleware.ts, PR #139) gates every mutating /api request, so
   * only a logged-in dashboard operator can reach this at all.
   *
   * Actor check (defense-in-depth + semantic attribution): `actor` must ALREADY
   * be an admin for this surface — either in the current explicit list, or,
   * before any explicit list exists, in the DM allowlist (the bootstrap set).
   * This ties the change to a concrete surface identity for the audit log and
   * keeps self-escalation blocked even if the transport gate is disabled via
   * its kill-switch (HSM_OPERATOR_TOKEN unset).
   *
   * Returns a discriminated result rather than throwing so the route can map it
   * to the right HTTP status.
   */
  setAdmins(
    harnessId: string,
    platform: string,
    admins: unknown,
    actor: string,
  ):
    | { ok: true; admins: string[] }
    | { ok: false; status: 400 | 403; error: string } {
    if (!isSupportedSurface(platform)) {
      return { ok: false, status: 400, error: `Unsupported platform: ${platform}` }
    }
    if (!Array.isArray(admins)) {
      return { ok: false, status: 400, error: 'admins must be an array' }
    }
    if (typeof actor !== 'string' || !actor.trim()) {
      return { ok: false, status: 400, error: 'actor is required' }
    }
    // Authorize BEFORE validating the new list, so the endpoint never reveals
    // anything to an unauthorized caller.
    if (!this.isAdmin(harnessId, platform, actor.trim())) {
      return { ok: false, status: 403, error: 'actor is not an admin for this surface' }
    }
    // Validate + dedupe every identity.
    const cleaned: string[] = []
    const seen = new Set<string>()
    for (const entry of admins) {
      if (!isValidIdentity(platform, entry)) {
        return { ok: false, status: 400, error: `Invalid ${platform} identity: ${String(entry)}` }
      }
      const id = (entry as string).trim()
      if (!seen.has(id)) {
        seen.add(id)
        cleaned.push(id)
      }
    }

    // Persist onto the harness overlay (read-modify-write the raw array — the
    // single persisted shape; HarnessService tolerates partial overlays).
    const overlays = this.readOverlays()
    const idx = overlays.findIndex((h) => h.id === harnessId)
    if (idx !== -1) {
      const existing = overlays[idx].surfaceAdmins ?? {}
      overlays[idx] = { ...overlays[idx], surfaceAdmins: { ...existing, [platform]: cleaned } }
    } else {
      overlays.push({ id: harnessId, surfaceAdmins: { [platform]: cleaned } })
    }
    this.storage.write(HARNESSES_FILE, overlays)

    this.audit?.append({
      who: actor.trim(),
      what: `surface-admins:set:${platform}`,
      target: harnessId,
      meta: { count: cleaned.length },
    })

    return { ok: true, admins: cleaned }
  }

  /**
   * Is `groupId` allowed on `platform` for this harness? Mirrors the existing
   * /policy?action=group-check logic, exposed at the REST path the plugin's
   * is_group_allowed() calls. Fail-closed; wildcard '*' means all groups.
   */
  isGroupAllowed(harnessId: string, platform: string, groupId: string): boolean {
    if (!harnessId || !platform || !groupId) return false
    const groupVars: Record<string, string> = {
      signal: 'SIGNAL_GROUP_ALLOWED_USERS',
      telegram: 'TELEGRAM_GROUP_ALLOWED_CHATS',
      mattermost: 'MATTERMOST_ALLOWED_CHANNELS',
      discord: 'DISCORD_ALLOWED_CHANNELS',
      slack: 'SLACK_ALLOWED_CHANNELS',
    }
    const varName = groupVars[platform]
    if (!varName) return false
    try {
      const env = parseEnvFile(path.join(agentDataDir(harnessId), '.env'))
      const raw = env[varName]
      if (raw === '*') return true
      return parseCommaList(raw).includes(groupId.trim())
    } catch {
      return false
    }
  }
}
