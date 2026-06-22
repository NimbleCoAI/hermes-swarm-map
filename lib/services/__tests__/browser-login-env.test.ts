import { describe, it, expect } from 'vitest'
import {
  serializeDescriptors,
  upsertBrowserLoginDescriptors,
  BROWSER_LOGIN_DESCRIPTORS_VAR as VAR,
} from '../browser-login-env'

const DESC = {
  acme: {
    login_url: 'https://acme.test/login',
    authed_probe_url: 'https://acme.test/account',
    authed_signal: 'Sign out',
    login_form_signal: 'Password',
  },
}

describe('serializeDescriptors', () => {
  it('serializes a non-empty object to single-line JSON', () => {
    const out = serializeDescriptors(DESC)
    expect(out).toBe(JSON.stringify(DESC))
    expect(out).not.toContain('\n')
  })

  it('returns empty string for empty object', () => {
    expect(serializeDescriptors({})).toBe('')
  })

  it('returns empty string for null/undefined', () => {
    expect(serializeDescriptors(null)).toBe('')
    expect(serializeDescriptors(undefined)).toBe('')
  })

  it('returns empty string for an array (not a descriptor map)', () => {
    expect(serializeDescriptors(['a', 'b'])).toBe('')
  })

  it('escapes U+2028 / U+2029 and never emits a raw newline-class char', () => {
    const LS = String.fromCharCode(0x2028)
    const PS = String.fromCharCode(0x2029)
    const out = serializeDescriptors({ svc: { authed_signal: `a${LS}b${PS}c` } })
    expect(out).not.toContain(LS)
    expect(out).not.toContain(PS)
    expect(out).toContain('\\u2028')
    expect(out).toContain('\\u2029')
    // strictly single physical line
    expect(out.split('\n').length).toBe(1)
  })
})

describe('upsertBrowserLoginDescriptors', () => {
  it('appends the var when absent', () => {
    const out = upsertBrowserLoginDescriptors('FOO=bar\n', DESC)
    expect(out).toContain('FOO=bar')
    expect(out).toContain(`${VAR}=${JSON.stringify(DESC)}`)
  })

  it('replaces the var when present', () => {
    const start = `FOO=bar\n${VAR}=old\nBAZ=qux\n`
    const out = upsertBrowserLoginDescriptors(start, DESC)
    expect(out).toContain(`${VAR}=${JSON.stringify(DESC)}`)
    expect(out).not.toContain(`${VAR}=old`)
    expect(out).toContain('BAZ=qux') // surrounding lines preserved
  })

  it('clears the var (empty value) when present and descriptors empty', () => {
    const start = `${VAR}=${JSON.stringify(DESC)}\n`
    const out = upsertBrowserLoginDescriptors(start, {})
    expect(out).toContain(`${VAR}=`)
    expect(out).not.toContain('acme')
  })

  it('is a no-op when absent and descriptors empty', () => {
    const start = 'FOO=bar\n'
    expect(upsertBrowserLoginDescriptors(start, {})).toBe(start)
  })

  it('does not interpret $ in JSON as a regex replacement token', () => {
    const withDollar = { svc: { authed_signal: 'Total $5 $& $1 balance' } }
    const start = `${VAR}=old\n`
    const out = upsertBrowserLoginDescriptors(start, withDollar)
    expect(out).toContain(`${VAR}=${JSON.stringify(withDollar)}`)
    expect(out).toContain('$5')
    expect(out).toContain('$&')
  })

  it('produces a single-line value even with spaces in signals', () => {
    const out = upsertBrowserLoginDescriptors('', DESC)
    const line = out.split('\n').find((l) => l.startsWith(`${VAR}=`))
    expect(line).toBeDefined()
    expect(line).toBe(`${VAR}=${JSON.stringify(DESC)}`)
  })
})
