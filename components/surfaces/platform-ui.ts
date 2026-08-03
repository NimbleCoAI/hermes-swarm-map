// components/surfaces/platform-ui.ts
//
// UI-layer derivations of the surface registry (lib/surfaces/registry.ts).
//
// The registry is pure and server-safe, so anything React- or copy-flavored
// lives here instead: Lucide icons, form-field labels, credential-field
// descriptors with placeholders. Every per-platform UI map that used to be
// hand-maintained in a page or dialog is either derived from the registry or
// declared here ONCE as Record<SurfaceSlug, ...> — so a new platform fails to
// compile (and fails platform-ui.test.ts) until its UI metadata exists, instead
// of silently falling through to a generic label.
//
// Wording rule carried over from the registry: the admission allowlist is who
// the bot ANSWERS, not who administers it. NEVER label these fields "Admins" —
// that conflation caused the silent-bot incident (see registry.ts header).

import { Hash, MessageSquare, Radio, Send } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { SURFACES, SURFACE_SLUGS, type SurfaceSlug } from '@/lib/surfaces/registry'

// ── Labels ────────────────────────────────────────────────────────────────────

/** { platform: display label } — derived from the registry's spec.label. */
export const SURFACE_LABELS: Record<SurfaceSlug, string> = Object.fromEntries(
  SURFACE_SLUGS.map((p) => [p, SURFACES[p].label]),
) as Record<SurfaceSlug, string>

// ── Icons ─────────────────────────────────────────────────────────────────────
//
// Icons are UI vocabulary, not registry facts. Two sites historically use two
// different vocabularies and both are preserved exactly (unifying them would be
// a visual change, out of scope for this refactor):
//  - the Surfaces catalog page differentiates platforms (Radio/Send/…)
//  - the harness surface list uses a coarser chat-vs-channel split

/** Catalog icons (Surfaces page). Paired with SURFACE_LABELS in SURFACE_META. */
export const SURFACE_CATALOG_ICONS: Record<SurfaceSlug, LucideIcon> = {
  signal: Radio,
  telegram: Send,
  mattermost: MessageSquare,
  discord: Hash,
  slack: MessageSquare,
}

/** Row icons for the harness surfaces tab (rendered at h-4 w-4). */
export const SURFACE_LIST_ICONS: Record<SurfaceSlug, LucideIcon> = {
  signal: MessageSquare,
  telegram: MessageSquare,
  mattermost: Hash,
  discord: MessageSquare,
  slack: Hash,
}

/** { platform: { icon, label } } — the Surfaces page card metadata. */
export const SURFACE_META: Record<SurfaceSlug, { icon: LucideIcon; label: string }> =
  Object.fromEntries(
    SURFACE_SLUGS.map((p) => [p, { icon: SURFACE_CATALOG_ICONS[p], label: SURFACE_LABELS[p] }]),
  ) as Record<SurfaceSlug, { icon: LucideIcon; label: string }>

// ── Admission field labels (settings UI) ──────────────────────────────────────

/**
 * Labels for the admission allowlist inputs ({P}_ALLOWED_USERS and the
 * group/channel allowlist). UI copy, keyed per platform because the native id
 * each platform stores differs (E.164 phones vs numeric chat ids vs channel
 * ids). These label ADMISSION — never "Admins" (admin privilege is the separate
 * surfaceAdmins overlay).
 */
export const ADMISSION_FIELD_LABELS: Record<SurfaceSlug, { users: string; groups: string }> = {
  signal: { users: 'Phone numbers (E.164)', groups: 'Group IDs' },
  telegram: { users: 'User IDs', groups: 'Chat IDs' },
  mattermost: { users: 'User IDs', groups: 'Channel IDs' },
  discord: { users: 'User IDs', groups: 'Channel IDs' },
  slack: { users: 'User IDs', groups: 'Channel IDs' },
}

// ── Credential form fields (edit-surface dialog) ──────────────────────────────

export type CredentialField = {
  /** Stable React key — historically identical to configKey. */
  key: string
  label: string
  /**
   * Key in the connect-route config payload; buildConnectEnvVars
   * (lib/env-helpers.ts) maps it to the env var this metadata is keyed by.
   */
  configKey: string
  placeholder?: string
}

/**
 * Per-credential-var UI metadata, keyed by the registry env var name. The
 * per-platform field lists below are derived by walking spec.credentials, so a
 * credential var added to the registry without an entry here fails the
 * invariant test (and throws at module load) instead of silently rendering no
 * input for it.
 */
export const CREDENTIAL_FIELD_META: Record<string, Omit<CredentialField, 'key'>> = {
  SIGNAL_ACCOUNT: { label: 'Phone Number (SIGNAL_ACCOUNT)', configKey: 'phone', placeholder: '+1234567890' },
  SIGNAL_HTTP_URL: { label: 'Signal HTTP URL', configKey: 'url', placeholder: 'http://host.docker.internal:8080' },
  TELEGRAM_BOT_TOKEN: { label: 'Bot Token (TELEGRAM_BOT_TOKEN)', configKey: 'token', placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz' },
  MATTERMOST_URL: { label: 'Mattermost URL', configKey: 'url', placeholder: 'https://mattermost.example.com' },
  MATTERMOST_TOKEN: { label: 'Bot Token (MATTERMOST_TOKEN)', configKey: 'token', placeholder: 'your-bot-token' },
  DISCORD_BOT_TOKEN: { label: 'Bot Token (DISCORD_BOT_TOKEN)', configKey: 'token', placeholder: 'MTAx...xxxx.xxxxxx.xxxx' },
  SLACK_BOT_TOKEN: { label: 'Bot Token (SLACK_BOT_TOKEN)', configKey: 'botToken', placeholder: 'xoxb-...' },
  SLACK_APP_TOKEN: { label: 'App Token (SLACK_APP_TOKEN)', configKey: 'appToken', placeholder: 'xapp-...' },
}

/**
 * { platform: credential form fields } — derived from spec.credentials in
 * registry order (which is also the stored/strip order). Replaces the
 * hand-maintained PLATFORM_FIELDS in edit-surface-dialog.
 */
export const PLATFORM_CREDENTIAL_FIELDS: Record<SurfaceSlug, CredentialField[]> =
  Object.fromEntries(
    SURFACE_SLUGS.map((p) => [
      p,
      SURFACES[p].credentials.map((envVar): CredentialField => {
        const meta = CREDENTIAL_FIELD_META[envVar]
        if (!meta) throw new Error(`No credential field metadata for ${envVar} (${p})`)
        return { key: meta.configKey, ...meta }
      }),
    ]),
  ) as Record<SurfaceSlug, CredentialField[]>
