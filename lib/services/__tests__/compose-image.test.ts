// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { generateStandaloneCompose, setComposeImage, readComposeImage } from '../harness-compose'

const REF = 'ghcr.io/nimblecoai/hermes-agent-mt:2026-06-12'

describe('setComposeImage', () => {
  it('replaces an existing image: line', () => {
    const c = generateStandaloneCompose('alpha', 8642, '/data/alpha', { imageOrBuild: { image: 'old:1' } })
    const out = setComposeImage(c, REF)
    expect(readComposeImage(out)).toBe(REF)
    expect(out).not.toContain('old:1')
  })

  it('replaces a build: block with image:', () => {
    const c = generateStandaloneCompose('beta', 8642, '/data/beta', { imageOrBuild: { build: '/src/hermes' } })
    expect(c).toContain('build:')
    const out = setComposeImage(c, REF)
    expect(readComposeImage(out)).toBe(REF)
    expect(out).not.toContain('build:')
    expect(out).not.toContain('/src/hermes')
    // structure preserved
    expect(out).toContain('container_name: hermes-beta')
    expect(out).toContain('command: gateway')
  })

  it('VPN variant: edits the hermes source block, NEVER the wireguard/camofox images', () => {
    const c = generateStandaloneCompose('gamma', 8642, '/data/gamma', { imageOrBuild: { build: '/src' }, vpnEnabled: true, camofoxImage: 'ghcr.io/nimblecoai/camofox:latest' })
    const out = setComposeImage(c, REF)
    expect(readComposeImage(out)).toBe(REF)
    expect(out).toContain('image: lscr.io/linuxserver/wireguard:latest') // untouched
    expect(out).toContain('image: ghcr.io/nimblecoai/camofox:latest') // untouched
    expect(out).not.toContain('build:')
  })

  it('is idempotent', () => {
    const c = generateStandaloneCompose('delta', 8642, '/data/delta', { imageOrBuild: { image: 'x:1' } })
    expect(setComposeImage(setComposeImage(c, REF), REF)).toBe(setComposeImage(c, REF))
  })

  it('throws if there is no hermes service', () => {
    expect(() => setComposeImage('services:\n  other:\n    image: x\n', REF)).toThrow(/no hermes/)
  })
})

describe('readComposeImage', () => {
  it('returns null for a build-based (local) compose', () => {
    const c = generateStandaloneCompose('eps', 8642, '/d', { imageOrBuild: { build: '/src' } })
    expect(readComposeImage(c)).toBeNull()
  })
})
