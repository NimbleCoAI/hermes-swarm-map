// Invariants for the UI-layer surface derivations (platform-ui.ts).
//
// Two jobs, mirroring lib/surfaces/registry.test.ts:
//  1. GOLDEN — pin each derived/declared map against the hand-maintained
//     literal it replaced, so this refactor is provably rendered-output
//     preserving.
//  2. STRUCTURAL — a platform added to the registry must bring complete UI
//     metadata (icons, admission labels, a field per credential var), and UI
//     metadata cannot reference vars the registry doesn't declare.
import { describe, it, expect } from 'vitest'
import { Hash, MessageSquare, Radio, Send } from 'lucide-react'
import { SURFACES, SURFACE_SLUGS } from '@/lib/surfaces/registry'
import { buildConnectEnvVars } from '@/lib/env-helpers'
import {
  SURFACE_LABELS,
  SURFACE_CATALOG_ICONS,
  SURFACE_LIST_ICONS,
  SURFACE_META,
  ADMISSION_FIELD_LABELS,
  CREDENTIAL_FIELD_META,
  PLATFORM_CREDENTIAL_FIELDS,
} from './platform-ui'

// ── Golden: derived maps == the literals they replaced ───────────────────────

describe('UI maps match the pre-derivation literals (rendered output unchanged)', () => {
  it('SURFACE_META == the Surfaces page PLATFORM_META literal', () => {
    expect(SURFACE_META).toEqual({
      signal: { icon: Radio, label: 'Signal' },
      telegram: { icon: Send, label: 'Telegram' },
      mattermost: { icon: MessageSquare, label: 'Mattermost' },
      discord: { icon: Hash, label: 'Discord' },
      slack: { icon: MessageSquare, label: 'Slack' },
    })
  })

  it('SURFACE_LIST_ICONS == the harness page PLATFORM_ICONS literal (surface rows)', () => {
    expect(SURFACE_LIST_ICONS).toEqual({
      signal: MessageSquare,
      telegram: MessageSquare,
      mattermost: Hash,
      discord: MessageSquare,
      slack: Hash,
    })
  })

  it('ADMISSION_FIELD_LABELS == the harness page PLATFORM_LABELS literal', () => {
    expect(ADMISSION_FIELD_LABELS).toEqual({
      signal: { users: 'Phone numbers (E.164)', groups: 'Group IDs' },
      telegram: { users: 'User IDs', groups: 'Chat IDs' },
      mattermost: { users: 'User IDs', groups: 'Channel IDs' },
      discord: { users: 'User IDs', groups: 'Channel IDs' },
      slack: { users: 'User IDs', groups: 'Channel IDs' },
    })
  })

  it('PLATFORM_CREDENTIAL_FIELDS == the edit-surface-dialog PLATFORM_FIELDS literal', () => {
    expect(PLATFORM_CREDENTIAL_FIELDS).toEqual({
      signal: [
        { key: 'phone', label: 'Phone Number (SIGNAL_ACCOUNT)', configKey: 'phone', placeholder: '+1234567890' },
        { key: 'url', label: 'Signal HTTP URL', configKey: 'url', placeholder: 'http://host.docker.internal:8080' },
      ],
      telegram: [
        { key: 'token', label: 'Bot Token (TELEGRAM_BOT_TOKEN)', configKey: 'token', placeholder: '123456789:ABCdefGHIjklMNOpqrsTUVwxyz' },
      ],
      mattermost: [
        { key: 'url', label: 'Mattermost URL', configKey: 'url', placeholder: 'https://mattermost.example.com' },
        { key: 'token', label: 'Bot Token (MATTERMOST_TOKEN)', configKey: 'token', placeholder: 'your-bot-token' },
      ],
      discord: [
        { key: 'token', label: 'Bot Token (DISCORD_BOT_TOKEN)', configKey: 'token', placeholder: 'MTAx...xxxx.xxxxxx.xxxx' },
      ],
      slack: [
        { key: 'botToken', label: 'Bot Token (SLACK_BOT_TOKEN)', configKey: 'botToken', placeholder: 'xoxb-...' },
        { key: 'appToken', label: 'App Token (SLACK_APP_TOKEN)', configKey: 'appToken', placeholder: 'xapp-...' },
      ],
    })
  })
})

// ── Structural: a new platform must bring complete UI metadata ───────────────

describe('UI metadata structural invariants', () => {
  it('every registry surface has an icon in both vocabularies + a label', () => {
    for (const p of SURFACE_SLUGS) {
      expect(SURFACE_CATALOG_ICONS[p], `${p} catalog icon`).toBeTruthy()
      expect(SURFACE_LIST_ICONS[p], `${p} list icon`).toBeTruthy()
      expect(SURFACE_META[p], `${p} meta`).toBeTruthy()
      expect(SURFACE_LABELS[p], `${p} label`).toBe(SURFACES[p].label)
      expect(SURFACE_META[p].label, `${p} meta label`).toBe(SURFACES[p].label)
    }
  })

  it('every registry surface has admission field labels — and never "Admin"', () => {
    // Admission (who the bot answers) is NOT admin privilege — labeling the
    // allowlist "Admins" caused the silent-bot incident (see registry.ts).
    for (const p of SURFACE_SLUGS) {
      const labels = ADMISSION_FIELD_LABELS[p]
      expect(labels?.users, `${p}.users label`).toBeTruthy()
      expect(labels?.groups, `${p}.groups label`).toBeTruthy()
      expect(labels.users.toLowerCase()).not.toContain('admin')
      expect(labels.groups.toLowerCase()).not.toContain('admin')
    }
  })

  it('every credential var has field metadata, in registry order, 1:1', () => {
    for (const p of SURFACE_SLUGS) {
      const fields = PLATFORM_CREDENTIAL_FIELDS[p]
      expect(fields.length, `${p} field count`).toBe(SURFACES[p].credentials.length)
      SURFACES[p].credentials.forEach((envVar, i) => {
        expect(CREDENTIAL_FIELD_META[envVar], `metadata for ${envVar}`).toBeTruthy()
        expect(fields[i].label).toBe(CREDENTIAL_FIELD_META[envVar].label)
      })
      // configKeys are the form's identity within a platform — must be unique,
      // and key (React key) has historically equaled configKey.
      const configKeys = fields.map((f) => f.configKey)
      expect(new Set(configKeys).size).toBe(configKeys.length)
      for (const f of fields) expect(f.key).toBe(f.configKey)
    }
  })

  it('no field metadata references a var absent from the registry', () => {
    const declared = new Set(SURFACE_SLUGS.flatMap((p) => SURFACES[p].credentials))
    for (const envVar of Object.keys(CREDENTIAL_FIELD_META)) {
      expect(declared.has(envVar), `${envVar} is not a registry credential`).toBe(true)
    }
  })

  it('configKeys round-trip through buildConnectEnvVars onto exactly spec.credentials', () => {
    // The dialog submits { [configKey]: value }; the connect route maps that to
    // env vars via buildConnectEnvVars. The fields for a platform must produce
    // exactly its registry credential set — no missing input, no orphan key.
    for (const p of SURFACE_SLUGS) {
      const config = Object.fromEntries(
        PLATFORM_CREDENTIAL_FIELDS[p].map((f) => [f.configKey, `test-${f.configKey}`]),
      )
      const envVars = buildConnectEnvVars(p, config)
      expect(Object.keys(envVars).sort(), `${p} env vars`).toEqual(
        [...SURFACES[p].credentials].sort(),
      )
      // And each field's value lands on the var its metadata is keyed by.
      for (const f of PLATFORM_CREDENTIAL_FIELDS[p]) {
        const envVar = Object.entries(CREDENTIAL_FIELD_META).find(
          ([v, m]) => m.configKey === f.configKey && SURFACES[p].credentials.includes(v),
        )?.[0]
        expect(envVar, `${p}.${f.configKey} maps to a credential var`).toBeTruthy()
        expect(envVars[envVar!]).toBe(`test-${f.configKey}`)
      }
    }
  })
})
