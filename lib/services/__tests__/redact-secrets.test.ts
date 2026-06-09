import { describe, it, expect } from 'vitest'
import { redactSecrets } from '../git-fetch'

describe('redactSecrets', () => {
  it('removes the known token value', () => {
    const out = redactSecrets('fatal: cannot read https://x-access-token:ghu_SECRETVALUE123456@github.com/o/r', 'ghu_SECRETVALUE123456')
    expect(out).not.toContain('ghu_SECRETVALUE123456')
  })

  it('scrubs GitHub token shapes even when the value is unknown', () => {
    expect(redactSecrets('leaked ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345')).not.toMatch(/ghp_[A-Za-z0-9]{16,}/)
    expect(redactSecrets('leaked github_pat_11ABCDEFG0_abcdefghijklmnopqrstuvwxyz')).not.toContain('github_pat_11ABCDEFG0')
  })

  it('scrubs user:secret@ credentials embedded in a URL', () => {
    const out = redactSecrets('clone https://x-access-token:supersecrettoken@github.com/o/r.git')
    expect(out).not.toContain('supersecrettoken')
    expect(out).toContain('x-access-token:***@')
  })

  it('leaves clean text untouched', () => {
    expect(redactSecrets('git clone failed: Repository not found')).toBe('git clone failed: Repository not found')
  })
})
