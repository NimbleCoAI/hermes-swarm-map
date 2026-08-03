// lib/resolvers/discord.ts

import fs from 'fs'
import path from 'path'
import os from 'os'
import type { ResolvedIdentity } from './signal'

function getDiscordBotToken(harnessId: string): string | null {
  const name = harnessId.replace(/^h_/, '').replace(/_/g, '-')
  const dataDir = name === 'personal'
    ? path.join(os.homedir(), '.hermes')
    : path.join(os.homedir(), `.hermes-${name}`)
  const envPath = path.join(dataDir, '.env')

  try {
    const content = fs.readFileSync(envPath, 'utf-8')
    const token = content.match(/^DISCORD_BOT_TOKEN=(.+)$/m)?.[1]?.trim()
    if (token) return token
  } catch {}
  return null
}

const DISCORD_API = 'https://discord.com/api/v10'

/**
 * Resolve a Discord username / global name / server nickname to the numeric
 * snowflake, by searching the members of every guild the bot is in.
 *
 * Discord has no global username→id lookup for bots; guild-member search is
 * the same surface the agent's own on_ready resolution uses, so HSM and the
 * runtime agree on what a username means. First match wins (matching the
 * adapter's semantics); the comparison is case-insensitive against username,
 * global_name and nick.
 *
 * Every failure path returns null — the caller stores the raw entry unchanged,
 * which is no worse than before this resolver existed.
 */
export async function resolveDiscordUsername(
  harnessId: string,
  username: string
): Promise<ResolvedIdentity | null> {
  const token = getDiscordBotToken(harnessId)
  if (!token) return null

  const query = (username.startsWith('@') ? username.slice(1) : username).trim()
  if (!query) return null
  const wanted = query.toLowerCase()
  const headers = { Authorization: `Bot ${token}` }

  try {
    const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, { headers })
    if (!guildsRes.ok) return null
    const guilds = (await guildsRes.json()) as Array<{ id: string }>
    if (!Array.isArray(guilds)) return null

    for (const guild of guilds) {
      const searchRes = await fetch(
        `${DISCORD_API}/guilds/${guild.id}/members/search?query=${encodeURIComponent(query)}&limit=25`,
        { headers },
      )
      if (!searchRes.ok) continue
      const members = (await searchRes.json()) as Array<{
        nick?: string | null
        user?: { id: string; username: string; global_name?: string | null }
      }>
      if (!Array.isArray(members)) continue

      for (const member of members) {
        const user = member.user
        if (!user?.id) continue
        const names = [user.username, user.global_name ?? '', member.nick ?? '']
        if (names.some((n) => n.toLowerCase() === wanted)) {
          return { display: query, nativeId: user.id, profileName: user.username }
        }
      }
    }
  } catch {}
  return null
}

const DISCORD_SNOWFLAKE_RE = /^[0-9]{5,25}$/

/**
 * Expand a Discord allowlist so every username entry is stored alongside its
 * resolved snowflake.
 *
 * The runtime matches inbound author ids against DISCORD_ALLOWED_USERS
 * verbatim, and the HSM policy plane (surface-admins bootstrap →
 * is_platform_admin) reads the same env var raw — a username-only entry
 * therefore authorizes at the agent (which resolves usernames itself at
 * on_ready) while staying permanently invisible to the policy plane. Storing
 * BOTH forms keeps the two planes agreeing on who the operator meant.
 *
 * - '*' and entries already in snowflake form pass through untouched.
 * - Usernames that resolve gain their snowflake alongside the name.
 * - Usernames that fail to resolve pass through unchanged (no worse than
 *   before; resolution retries on the next write).
 *
 * Order is preserved and duplicates are removed — mirrors
 * expandSignalAllowlist.
 */
export async function expandDiscordAllowlist(
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
    if (id === '*' || DISCORD_SNOWFLAKE_RE.test(id)) continue
    const resolved = await resolveDiscordUsername(harnessId, id)
    if (resolved?.nativeId) push(resolved.nativeId)
  }

  return out
}
