import { describe, it, expect } from 'vitest'
import { parseKeyRequestParams } from '@/lib/keys-request'

const params = (qs: string) => new URLSearchParams(qs)

describe('parseKeyRequestParams', () => {
  it('returns null when there is no request param', () => {
    expect(parseKeyRequestParams(params(''))).toBeNull()
    expect(parseKeyRequestParams(params('assign=h_mare&name=Mare'))).toBeNull()
  })

  it('parses a bare provider request', () => {
    expect(parseKeyRequestParams(params('request=hedra'))).toEqual({
      provider: 'hedra',
      assignTo: [],
      name: undefined,
    })
  })

  it('parses comma-separated assign ids and optional name', () => {
    expect(parseKeyRequestParams(params('request=hedra&assign=h_mare,h_cyborg&name=Mare%20Video'))).toEqual({
      provider: 'hedra',
      assignTo: ['h_mare', 'h_cyborg'],
      name: 'Mare Video',
    })
  })

  it('normalizes the provider to a lowercase trimmed slug', () => {
    expect(parseKeyRequestParams(params('request=%20Hedra%20'))?.provider).toBe('hedra')
  })

  it('rejects empty or malformed provider slugs', () => {
    expect(parseKeyRequestParams(params('request='))).toBeNull()
    expect(parseKeyRequestParams(params('request=%20%20'))).toBeNull()
    expect(parseKeyRequestParams(params('request=he%3Cdra%3E'))).toBeNull()
  })

  it('drops empty entries in the assign list', () => {
    expect(parseKeyRequestParams(params('request=hedra&assign=h_mare,,%20'))?.assignTo).toEqual(['h_mare'])
  })

  it('filters assign ids against known harness ids when provided', () => {
    const parsed = parseKeyRequestParams(params('request=hedra&assign=h_mare,h_ghost'), ['h_mare', 'h_cyborg'])
    expect(parsed?.assignTo).toEqual(['h_mare'])
  })
})
