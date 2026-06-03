import { describe, it, expect, afterEach } from 'vitest'
import { hsmPort, hsmBaseUrl } from '../hsm-url'

describe('hsm-url', () => {
  const original = process.env.PORT
  afterEach(() => {
    if (original === undefined) delete process.env.PORT
    else process.env.PORT = original
  })

  it('defaults hsmPort to 3000 when PORT is unset', () => {
    delete process.env.PORT
    expect(hsmPort()).toBe('3000')
  })

  it('uses process.env.PORT when set', () => {
    process.env.PORT = '4242'
    expect(hsmPort()).toBe('4242')
  })

  it('builds the host.docker.internal callback URL', () => {
    delete process.env.PORT
    expect(hsmBaseUrl()).toBe('http://host.docker.internal:3000')
  })
})
