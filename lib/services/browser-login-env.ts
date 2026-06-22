/**
 * Browser-login platform descriptors → agent `.env`.
 *
 * The `browser_login` plugin (infra/templates/plugins/browser_login) reads
 * platform login descriptors from the `BROWSER_LOGIN_DESCRIPTORS` env var (a
 * JSON object keyed by platform), merged over its bundled defaults. HSM owns the
 * operator-editable descriptors as a global setting (`platformLoginDescriptors`)
 * and writes them into each agent's `.env` here — same delivery mechanism as
 * `VNC_EXTERNAL_URL`. Editing the setting + saving recreates the container, so
 * the new value takes effect (env_file is read at container creation).
 *
 * Design: memory/specs/2026-06-22-credentialless-browser-login-phase1-build.md §4
 */

export const BROWSER_LOGIN_DESCRIPTORS_VAR = 'BROWSER_LOGIN_DESCRIPTORS'

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/**
 * Serialize descriptors to a single-line JSON string suitable for a `.env`
 * value. Returns '' for anything that isn't a non-empty plain object (the
 * plugin treats an empty/absent value as "use bundled defaults").
 */
export function serializeDescriptors(descriptors: unknown): string {
  if (!descriptors || typeof descriptors !== 'object' || Array.isArray(descriptors)) {
    return ''
  }
  const keys = Object.keys(descriptors as Record<string, unknown>)
  if (keys.length === 0) return ''
  // JSON.stringify (no indent) is single-line and escapes \n and \r inside
  // string values, so it is safe as a one-line .env value. JSON.stringify does
  // NOT escape U+2028/U+2029 — those are not line terminators for dotenv or
  // docker-compose env_file, so escaping them is defense-in-depth (descriptors
  // are operator-set, not adversarial), guaranteeing a strictly single line.
  return JSON.stringify(descriptors)
    .split(LINE_SEPARATOR).join('\\u2028')
    .split(PARAGRAPH_SEPARATOR).join('\\u2029')
}

/**
 * Upsert `BROWSER_LOGIN_DESCRIPTORS=<json>` into a `.env` file's content.
 * - present + non-empty value → replace the line
 * - present + empty value → clear the line (set to empty, descriptors removed)
 * - absent + non-empty value → append
 * - absent + empty value → no-op
 *
 * Uses a function replacement so `$` in the JSON is never interpreted as a
 * regex replacement token.
 */
export function upsertBrowserLoginDescriptors(content: string, descriptors: unknown): string {
  const value = serializeDescriptors(descriptors)
  const regex = new RegExp(`^${BROWSER_LOGIN_DESCRIPTORS_VAR}=.*$`, 'm')
  if (regex.test(content)) {
    return content.replace(regex, () => `${BROWSER_LOGIN_DESCRIPTORS_VAR}=${value}`)
  }
  if (!value) return content
  return content.trimEnd() + `\n${BROWSER_LOGIN_DESCRIPTORS_VAR}=${value}\n`
}
