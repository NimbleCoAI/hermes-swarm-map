// @vitest-environment node
//
// Invariants for the surface registry. These pin the derived maps against the
// literals they replaced (so the refactor is provably behavior-preserving) AND
// encode the structural rules that keep future edits sane — a new platform, or a
// new var, that violates a class rule fails here instead of shipping as drift.
import { describe, it, expect } from 'vitest'
import { SURFACES, SURFACE_SLUGS, isSurfaceSlug, surfaceSpec } from './registry'
import {
  USERS_VARS,
  GROUPS_VARS,
  MENTION_GATING_VARS,
  OBSERVE_UNMENTIONED_VARS,
  GROUP_INVITE_POLICY_VARS,
  PLATFORM_VARS,
  POLICY_VARS,
  PLATFORM_ENV_KEYS,
  surfaceStripVars,
  ALL_SURFACE_VARS,
} from './derive'

// ── Golden: derived maps == the literals they replaced ───────────────────────
// If any of these fail, the registry changed a value a live consumer depends on.

describe('derived maps match the pre-registry literals (byte-for-byte)', () => {
  it('USERS_VARS == ALLOWED_USERS_VARS / allowedUsersKey / PLATFORM_VARS.users', () => {
    expect(USERS_VARS).toEqual({
      signal: 'SIGNAL_ALLOWED_USERS',
      telegram: 'TELEGRAM_ALLOWED_USERS',
      mattermost: 'MATTERMOST_ALLOWED_USERS',
      discord: 'DISCORD_ALLOWED_USERS',
      slack: 'SLACK_ALLOWED_USERS',
    })
  })

  it('GROUPS_VARS == GROUP_ALLOWED_VARS / GROUP_VARS', () => {
    expect(GROUPS_VARS).toEqual({
      signal: 'SIGNAL_GROUP_ALLOWED_USERS',
      telegram: 'TELEGRAM_GROUP_ALLOWED_CHATS',
      mattermost: 'MATTERMOST_ALLOWED_CHANNELS',
      discord: 'DISCORD_ALLOWED_CHANNELS',
      slack: 'SLACK_ALLOWED_CHANNELS',
    })
  })

  it('MENTION_GATING_VARS covers all five', () => {
    expect(MENTION_GATING_VARS).toEqual({
      signal: 'SIGNAL_REQUIRE_MENTION',
      telegram: 'TELEGRAM_REQUIRE_MENTION',
      mattermost: 'MATTERMOST_REQUIRE_MENTION',
      discord: 'DISCORD_REQUIRE_MENTION',
      slack: 'SLACK_REQUIRE_MENTION',
    })
  })

  it('OBSERVE_UNMENTIONED_VARS covers exactly signal/mattermost/telegram', () => {
    expect(OBSERVE_UNMENTIONED_VARS).toEqual({
      signal: 'SIGNAL_OBSERVE_UNMENTIONED',
      mattermost: 'MATTERMOST_OBSERVE_UNMENTIONED',
      telegram: 'TELEGRAM_OBSERVE_UNMENTIONED_GROUP_MESSAGES',
    })
  })

  it('GROUP_INVITE_POLICY_VARS covers exactly signal/slack/telegram', () => {
    expect(GROUP_INVITE_POLICY_VARS).toEqual({
      signal: 'SIGNAL_GROUP_INVITE_POLICY',
      slack: 'SLACK_CHANNEL_POLICY',
      telegram: 'TELEGRAM_GROUP_INVITE_POLICY',
    })
  })

  it('PLATFORM_VARS matches the settings-route shape (Discord carries the extras)', () => {
    expect(PLATFORM_VARS).toEqual({
      signal: { users: 'SIGNAL_ALLOWED_USERS', groups: 'SIGNAL_GROUP_ALLOWED_USERS' },
      telegram: { users: 'TELEGRAM_ALLOWED_USERS', groups: 'TELEGRAM_GROUP_ALLOWED_CHATS' },
      mattermost: { users: 'MATTERMOST_ALLOWED_USERS', groups: 'MATTERMOST_ALLOWED_CHANNELS' },
      discord: {
        users: 'DISCORD_ALLOWED_USERS',
        groups: 'DISCORD_ALLOWED_CHANNELS',
        roles: 'DISCORD_ALLOWED_ROLES',
        ignoredGroups: 'DISCORD_IGNORED_CHANNELS',
        allowBots: 'DISCORD_ALLOW_BOTS',
      },
      slack: { users: 'SLACK_ALLOWED_USERS', groups: 'SLACK_ALLOWED_CHANNELS' },
    })
  })

  it('POLICY_VARS == env-helpers POLICY_VARS', () => {
    expect(POLICY_VARS).toEqual({
      signal: ['SIGNAL_ALLOWED_USERS', 'SIGNAL_GROUP_ALLOWED_USERS', 'SIGNAL_REQUIRE_MENTION'],
      telegram: ['TELEGRAM_ALLOWED_USERS', 'TELEGRAM_GROUP_ALLOWED_CHATS', 'TELEGRAM_REQUIRE_MENTION'],
      mattermost: ['MATTERMOST_ALLOWED_USERS', 'MATTERMOST_ALLOWED_CHANNELS', 'MATTERMOST_REQUIRE_MENTION'],
      discord: ['DISCORD_ALLOWED_USERS', 'DISCORD_ALLOWED_CHANNELS', 'DISCORD_REQUIRE_MENTION'],
      slack: ['SLACK_ALLOWED_USERS', 'SLACK_ALLOWED_CHANNELS', 'SLACK_REQUIRE_MENTION'],
    })
  })

  it('PLATFORM_ENV_KEYS == disconnect strip list (the fixed, consistent one)', () => {
    // NB: mattermost includes MATTERMOST_ADMIN_USERS — matching the disconnect
    // route. The harness DUPLICATE path historically omitted it (drift D4); once
    // it derives from surfaceStripVars too, a clone stops inheriting the source's
    // Mattermost admins. That is an intended consistency fix, asserted below.
    expect(PLATFORM_ENV_KEYS).toEqual({
      signal: ['SIGNAL_ACCOUNT', 'SIGNAL_HTTP_URL', 'SIGNAL_ALLOWED_USERS', 'SIGNAL_GROUP_ALLOWED_USERS'],
      telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALLOWED_USERS', 'TELEGRAM_GROUP_ALLOWED_CHATS'],
      mattermost: ['MATTERMOST_URL', 'MATTERMOST_TOKEN', 'MATTERMOST_ALLOWED_USERS', 'MATTERMOST_ALLOWED_CHANNELS', 'MATTERMOST_ADMIN_USERS'],
      discord: ['DISCORD_BOT_TOKEN', 'DISCORD_ALLOWED_USERS', 'DISCORD_ALLOWED_CHANNELS', 'DISCORD_ALLOWED_ROLES', 'DISCORD_IGNORED_CHANNELS'],
      slack: ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_ALLOWED_USERS', 'SLACK_ALLOWED_CHANNELS'],
    })
  })
})

// ── Structural invariants: the rules that keep a new platform honest ─────────

describe('registry structural invariants', () => {
  it('every surface has the mandatory admission + behavior primitives', () => {
    for (const p of SURFACE_SLUGS) {
      const s = SURFACES[p]
      expect(s.admission.users, `${p}.admission.users`).toBeTruthy()
      expect(s.admission.groups, `${p}.admission.groups`).toBeTruthy()
      expect(s.behavior.requireMention, `${p}.behavior.requireMention`).toBeTruthy()
    }
  })

  it('every var name is prefixed with its platform (Signal profile aside)', () => {
    for (const p of SURFACE_SLUGS) {
      const s = SURFACES[p]
      const prefix = p.toUpperCase()
      const all = [
        ...s.credentials,
        ...Object.values(s.admission),
        ...Object.values(s.behavior),
      ].filter(Boolean) as string[]
      for (const v of all) {
        expect(v.startsWith(prefix + '_'), `${v} should start with ${prefix}_`).toBe(true)
      }
    }
  })

  it('no var name is reused across two surfaces', () => {
    const seen = new Map<string, string>()
    for (const p of SURFACE_SLUGS) {
      const s = SURFACES[p]
      const all = [
        ...s.credentials,
        ...Object.values(s.admission),
        ...Object.values(s.behavior),
      ].filter(Boolean) as string[]
      for (const v of all) {
        expect(seen.has(v), `${v} declared on both ${seen.get(v)} and ${p}`).toBe(false)
        seen.set(v, p)
      }
    }
  })

  it('strip list = credentials + admission, and NEVER a behavior var', () => {
    for (const p of SURFACE_SLUGS) {
      const s = SURFACES[p]
      const strip = new Set(surfaceStripVars(p))
      for (const c of s.credentials) expect(strip.has(c)).toBe(true)
      for (const a of Object.values(s.admission)) if (a) expect(strip.has(a)).toBe(true)
      // Behavior vars are KEPT on disconnect — the load-bearing rule.
      for (const b of Object.values(s.behavior)) if (b) expect(strip.has(b)).toBe(false)
    }
  })

  it('ALL_SURFACE_VARS contains every declared var and nothing else', () => {
    for (const p of SURFACE_SLUGS) {
      const s = SURFACES[p]
      const all = [
        ...s.credentials,
        ...Object.values(s.admission),
        ...Object.values(s.behavior),
      ].filter(Boolean) as string[]
      for (const v of all) expect(ALL_SURFACE_VARS.has(v)).toBe(true)
    }
    // 35 distinct vars across five surfaces: the inventory's union of 34
    // (which predated DISCORD_CHANNEL_SCOPED_ACCESS) plus that flag. NB the
    // first cut of this test also said 34 — but by coincidence (it was missing
    // SIGNAL_PROFILE_NAME while adding the CSA flag). Count assertions must be
    // paired with membership assertions to mean anything:
    expect(ALL_SURFACE_VARS.has('SIGNAL_PROFILE_NAME')).toBe(true)
    expect(ALL_SURFACE_VARS.has('DISCORD_CHANNEL_SCOPED_ACCESS')).toBe(true)
    expect(ALL_SURFACE_VARS.size).toBe(35)
  })

  it('isSurfaceSlug / surfaceSpec agree with the SURFACES keys', () => {
    expect(SURFACE_SLUGS.sort()).toEqual(['discord', 'mattermost', 'signal', 'slack', 'telegram'])
    expect(isSurfaceSlug('discord')).toBe(true)
    expect(isSurfaceSlug('mastodon')).toBe(false)
    expect(surfaceSpec('discord')?.slug).toBe('discord')
    expect(surfaceSpec('nope')).toBeUndefined()
  })
})

// ── Known, deliberately-unresolved divergences (drift D8) ────────────────────
// Two legacy sites validate the "same" native id with different bounds. Phase 1
// does NOT unify them (that would change validation behavior); this test DOCUMENTS
// the divergence so it is visible and tracked, and fails loudly if either side
// moves unexpectedly. Unifying onto registry.identity.nativePattern is a
// follow-up (needs its own behavior review).

describe('known identity-regex divergence (tracked, not yet unified)', () => {
  it('discord: canonical is 15–21 digits; isValidIdentity still accepts 5–25', () => {
    const canonical = SURFACES.discord.identity.nativePattern
    expect(canonical.test('123456789012345678')).toBe(true) // 18-digit snowflake
    expect(canonical.test('12345')).toBe(false) // canonical rejects 5-digit
    // The follow-up is to make surface-admins.isValidIdentity derive from
    // canonical; until then a 5-digit value is accepted there and refused here.
  })
})
