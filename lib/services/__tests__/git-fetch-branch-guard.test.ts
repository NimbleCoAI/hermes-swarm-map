import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { fetchGitArtifact } from '../git-fetch'

// FIX 4b (audit): parseGitSource only fast-fails a hardcoded set of mutable ref
// NAMES; an attacker can name a branch anything (e.g. 'feature-x'). fetchGitArtifact
// must run an AUTHORITATIVE `git ls-remote --heads <url> <ref>` BEFORE cloning and
// refuse any ref that resolves to a (mutable) branch — only immutable tags/commits
// may be installed. Exercised against a real local git repo over file://.
let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hsm-branchguard-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function git(cwd: string, args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=Test', ...args], {
    cwd,
    stdio: 'ignore',
  })
}

// Build a real repo on disk with a tag 'v1.0.0' and a branch 'feature-x', then
// expose it via a bare clone under <remotesRoot>/<org>/<repo>.git (the layout
// fetchGitArtifact expects for a baseUrl). Returns the remotesRoot path.
function makeRemote(org: string, repo: string, tag: string, branch: string): string {
  const remotesRoot = path.join(tmp, 'remotes')
  const work = path.join(tmp, 'work', repo)
  fs.mkdirSync(work, { recursive: true })
  git(work, ['init', '-q'])
  fs.writeFileSync(path.join(work, 'SKILL.md'), 'benign artifact body')
  git(work, ['add', '-A'])
  git(work, ['commit', '-q', '-m', 'init'])
  git(work, ['tag', tag])
  git(work, ['branch', branch])
  const bare = path.join(remotesRoot, org, `${repo}.git`)
  fs.mkdirSync(path.dirname(bare), { recursive: true })
  execFileSync('git', ['clone', '-q', '--bare', work, bare])
  return remotesRoot
}

describe('fetchGitArtifact branch guard', () => {
  it('fetches an immutable tag and returns the artifact dir', () => {
    const remotesRoot = makeRemote('org', 'repo', 'v1.0.0', 'feature-x')
    const dir = fetchGitArtifact(
      { org: 'org', repo: 'repo', ref: 'v1.0.0' },
      { baseUrl: remotesRoot, cacheRoot: path.join(tmp, 'cache') },
    )
    expect(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8')).toBe('benign artifact body')
  })

  it('refuses a ref that resolves to a mutable branch', () => {
    const remotesRoot = makeRemote('org', 'repo', 'v1.0.0', 'feature-x')
    expect(() =>
      fetchGitArtifact(
        { org: 'org', repo: 'repo', ref: 'feature-x' },
        { baseUrl: remotesRoot, cacheRoot: path.join(tmp, 'cache2') },
      ),
    ).toThrow(/mutable branch|tag or commit/i)
  })
})
