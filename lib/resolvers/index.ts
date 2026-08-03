// lib/resolvers/index.ts

export type { ResolvedIdentity } from './signal'
export { resolveSignalPhone, getSignalAccountUuid } from './signal'
export { resolveTelegramUsername, getTelegramDisplayName } from './telegram'
export { resolveMattermostUsername } from './mattermost'
export { resolveDiscordUsername, expandDiscordAllowlist } from './discord'

import { resolveSignalPhone } from './signal'
import { resolveTelegramUsername } from './telegram'
import { resolveMattermostUsername } from './mattermost'
import { resolveDiscordUsername } from './discord'
import { SURFACES } from '@/lib/surfaces/registry'
import type { ResolvedIdentity } from './signal'

// "Already a native id — skip resolution" checks, all sourced from the
// canonical registry.identity.nativePattern (lib/surfaces/registry.ts) so the
// bounds cannot drift from the single source of truth (drift D8, now unified).
const TELEGRAM_NATIVE_RE = SURFACES.telegram.identity.nativePattern
const MATTERMOST_NATIVE_RE = SURFACES.mattermost.identity.nativePattern
const DISCORD_NATIVE_RE = SURFACES.discord.identity.nativePattern

// Signal's canonical pattern matches BOTH native forms — phone and UUID — but
// only a UUID may skip resolution: a phone entry still resolves so its
// sealed-sender UUID can be stored/displayed alongside it. The dash test
// selects the UUID alternative (the phone arm has no dashes).
const isSignalUuid = (id: string) =>
  SURFACES.signal.identity.nativePattern.test(id) && id.includes('-')

/**
 * Expand a Signal allowlist so every phone-number entry is stored alongside its
 * resolved UUID.
 *
 * Sealed-sender DMs identify the sender only by UUID, never phone number, and
 * the gateway matches that inbound UUID against SIGNAL_ALLOWED_USERS verbatim.
 * A phone-number-only allowlist therefore silently rejects the very person it
 * names (e.g. a fresh contact with no groups in common). Storing BOTH the phone
 * and its UUID makes the allowlist match whichever identifier signal-cli
 * surfaces for a given contact relationship.
 *
 * - '*' and entries already in UUID form pass through untouched.
 * - Phone numbers that resolve gain their UUID alongside the number.
 * - Phone numbers that fail to resolve pass through unchanged (no worse than
 *   before; resolution retries on the next write once the daemon can see them).
 *
 * Order is preserved and duplicates are removed.
 */
export async function expandSignalAllowlist(
  harnessId: string,
  identifiers: string[]
): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }

  for (const raw of identifiers) {
    const id = raw.trim()
    if (!id) continue
    push(id)
    if (id === '*' || isSignalUuid(id) || !id.startsWith('+')) continue
    const resolved = await resolveSignalPhone(harnessId, id)
    if (resolved?.nativeId) push(resolved.nativeId)
  }

  return out
}

export type TelegramAdminResolution =
  | { ok: true; ids: string[]; resolved: ResolvedIdentity[] }
  | { ok: false; error: string }

/**
 * Resolve a list of Telegram admin entries (numeric IDs and/or @usernames) to
 * numeric user IDs. STRICT: any @username that fails to resolve is an error —
 * the runtime matches TELEGRAM_ALLOWED_USERS against numeric sender IDs only,
 * so silently storing a raw handle produces an allowlist that never matches
 * (the admin is locked out with no visible symptom).
 *
 * `botToken` is passed through to getChat so this works at connect time, before
 * TELEGRAM_BOT_TOKEN has been written to the agent .env.
 *
 * Order is preserved; duplicates (same numeric ID) are removed.
 */
export async function resolveTelegramAdmins(
  harnessId: string,
  entries: string[],
  botToken?: string
): Promise<TelegramAdminResolution> {
  const ids: string[] = []
  const resolved: ResolvedIdentity[] = []
  const seen = new Set<string>()

  for (const raw of entries) {
    const entry = raw.trim()
    if (!entry) continue
    if (entry === '*') {
      return { ok: false, error: 'Wildcard (*) is not a valid admin entry' }
    }
    if (TELEGRAM_NATIVE_RE.test(entry)) {
      if (!seen.has(entry)) {
        seen.add(entry)
        ids.push(entry)
        resolved.push({ display: entry, nativeId: entry })
      }
      continue
    }
    const result = await resolveTelegramUsername(harnessId, entry, botToken)
    if (!result?.nativeId) {
      const handle = entry.startsWith('@') ? entry : `@${entry}`
      return {
        ok: false,
        error: `Could not resolve ${handle} to a Telegram user ID. Check the spelling, or use the numeric user ID instead (the account must have a public username).`,
      }
    }
    if (!seen.has(result.nativeId)) {
      seen.add(result.nativeId)
      ids.push(result.nativeId)
      resolved.push(result)
    }
  }

  return { ok: true, ids, resolved }
}

/**
 * Expand a Telegram allowlist so every @username entry is stored alongside its
 * resolved numeric user ID (mirrors expandSignalAllowlist).
 *
 * The gateway matches inbound sender IDs — always numeric — against
 * TELEGRAM_ALLOWED_USERS verbatim, so an @username-only entry never matches
 * anyone. Best-effort: entries that fail to resolve pass through unchanged
 * (no worse than before; resolution retries on the next settings write).
 *
 * Order is preserved and duplicates are removed.
 */
export async function expandTelegramAllowlist(
  harnessId: string,
  identifiers: string[]
): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (value: string) => {
    const trimmed = value.trim()
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed)
      out.push(trimmed)
    }
  }

  for (const raw of identifiers) {
    const id = raw.trim()
    if (!id) continue
    push(id)
    if (id === '*' || TELEGRAM_NATIVE_RE.test(id)) continue
    const resolved = await resolveTelegramUsername(harnessId, id)
    if (resolved?.nativeId) push(resolved.nativeId)
  }

  return out
}

/**
 * Resolve an identifier for a given platform.
 * Detects whether the input is already a native ID or needs resolution.
 */
export async function resolveIdentifier(
  harnessId: string,
  platform: string,
  identifier: string
): Promise<ResolvedIdentity | null> {
  switch (platform) {
    case 'signal': {
      // Already a UUID — skip resolution (phones resolve: sealed-sender)
      if (isSignalUuid(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveSignalPhone(harnessId, identifier)
    }
    case 'telegram': {
      // Already numeric — skip resolution
      if (TELEGRAM_NATIVE_RE.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveTelegramUsername(harnessId, identifier)
    }
    case 'mattermost': {
      // Already a 26-char alphanumeric ID — skip
      if (MATTERMOST_NATIVE_RE.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveMattermostUsername(harnessId, identifier)
    }
    case 'discord': {
      // Already a snowflake — skip resolution (same registry pattern
      // DISCORD_SNOWFLAKE_RE in ./discord.ts sources).
      if (DISCORD_NATIVE_RE.test(identifier)) {
        return { display: identifier, nativeId: identifier }
      }
      return resolveDiscordUsername(harnessId, identifier)
    }
    default:
      return null
  }
}
