import { describe, it, expect } from 'vitest'
import { parseGitSource } from '../artifacts-manifest'

// parseGitSource is the security-critical front door for git-sourced artifacts.
// Format: git:<org>/<repo>#<tag>[:<subdir>]
// - pinning is MANDATORY (an unpinned source can silently drift to malicious code)
// - org/repo/ref/subdir are charset-validated (the ref later feeds a git command,
//   so a stray shell metacharacter or path-traversal must be rejected loudly)
describe('parseGitSource', () => {
  it('returns null for non-git sources so installArtifacts routes them elsewhere', () => {
    expect(parseGitSource('local')).toBeNull()
    expect(parseGitSource('upstream')).toBeNull()
    expect(parseGitSource('')).toBeNull()
  })

  it('parses git:<org>/<repo>#<tag>', () => {
    expect(parseGitSource('git:NimbleCoAI/captcha-skill#v1.0.0')).toEqual({
      org: 'NimbleCoAI',
      repo: 'captcha-skill',
      ref: 'v1.0.0',
    })
  })

  it('parses an optional :<subdir>', () => {
    expect(parseGitSource('git:NimbleCoAI/pack#v2.3.1:skills/captcha')).toEqual({
      org: 'NimbleCoAI',
      repo: 'pack',
      ref: 'v2.3.1',
      subdir: 'skills/captcha',
    })
  })

  it('rejects an unpinned git source (no #ref) — pinning is mandatory', () => {
    expect(() => parseGitSource('git:NimbleCoAI/captcha-skill')).toThrow(/pinned|ref/i)
  })

  it('rejects an empty ref', () => {
    expect(() => parseGitSource('git:NimbleCoAI/captcha-skill#')).toThrow(/pinned|ref/i)
  })

  it('rejects a malformed source missing org/repo', () => {
    expect(() => parseGitSource('git:badformat#v1')).toThrow(/org\/repo|malformed|invalid/i)
  })

  it('rejects an extra path segment in org/repo', () => {
    expect(() => parseGitSource('git:org/repo/extra#v1')).toThrow(/org\/repo|malformed|invalid/i)
  })

  it('rejects unsafe characters in the ref (command-injection guard)', () => {
    expect(() => parseGitSource('git:org/repo#v1;rm -rf /')).toThrow(/invalid|unsafe/i)
  })

  it('rejects path traversal in the subdir', () => {
    expect(() => parseGitSource('git:org/repo#v1:../../etc')).toThrow(/traversal|invalid|unsafe/i)
  })

  // FIX 4a (audit): a branch/HEAD ref is MUTABLE — it can silently drift to
  // malicious code after review. Only immutable tags/commits are allowed.
  it('rejects mutable refs (HEAD / main / master / develop, case-insensitive)', () => {
    expect(() => parseGitSource('git:org/repo#main')).toThrow(/mutable|branch|tag|commit/i)
    expect(() => parseGitSource('git:org/repo#HEAD')).toThrow(/mutable|branch|tag|commit/i)
    expect(() => parseGitSource('git:org/repo#master')).toThrow(/mutable|branch|tag|commit/i)
    expect(() => parseGitSource('git:org/repo#develop')).toThrow(/mutable|branch|tag|commit/i)
    expect(() => parseGitSource('git:org/repo#Main')).toThrow(/mutable|branch|tag|commit/i)
  })

  it('still allows version tags and hex commit SHAs', () => {
    expect(parseGitSource('git:org/repo#v1.2.3')).toEqual({ org: 'org', repo: 'repo', ref: 'v1.2.3' })
    const sha = 'a'.repeat(40)
    expect(parseGitSource(`git:org/repo#${sha}`)).toEqual({ org: 'org', repo: 'repo', ref: sha })
  })

  it('still allows hierarchical tags containing "/"', () => {
    expect(parseGitSource('git:org/repo#release/v1.2.3')).toEqual({
      org: 'org',
      repo: 'repo',
      ref: 'release/v1.2.3',
    })
  })
})
