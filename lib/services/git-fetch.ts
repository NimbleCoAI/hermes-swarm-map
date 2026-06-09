import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import type { GitSource } from './artifacts-manifest'

export interface FetchOpts {
  // Base URL/path for resolving <org>/<repo>.git; the repo is appended as
  // `${baseUrl}/${org}/${repo}.git`. Defaults to GitHub HTTPS. A local path is
  // accepted (used by tests + self-hosted mirrors).
  baseUrl?: string
  // Build-time token injected into the HTTPS URL (HSM server env, distinct from
  // the agent's runtime GITHUB_TOKEN). Ignored when baseUrl is set.
  token?: string
  // Where clones are placed; a unique subdir is created per fetch.
  cacheRoot: string
}

function buildUrl(src: GitSource, opts: FetchOpts): string {
  if (opts.baseUrl) {
    return `${opts.baseUrl.replace(/\/+$/, '')}/${src.org}/${src.repo}.git`
  }
  const auth = opts.token ? `${opts.token}@` : ''
  return `https://${auth}github.com/${src.org}/${src.repo}.git`
}

/**
 * Shallow-clone a git-sourced artifact at its PINNED tag and return the path to
 * the artifact root (the clone, or its subdir).
 *
 * Pinning + charset safety are enforced upstream by parseGitSource; here we
 * clone exactly that ref with --depth 1 and `--` so the ref/url can never be
 * read as a git option. A subdir is resolved and verified to stay inside the
 * clone (defense against an escaping/`..` subdir that slipped through).
 */
export function fetchGitArtifact(src: GitSource, opts: FetchOpts): string {
  fs.mkdirSync(opts.cacheRoot, { recursive: true })
  const dest = fs.mkdtempSync(path.join(opts.cacheRoot, `${src.repo}-`))
  const url = buildUrl(src, opts)

  execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', src.ref, '--', url, dest], {
    stdio: 'ignore',
  })

  if (!src.subdir) return dest

  const root = path.resolve(dest)
  const resolved = path.resolve(dest, src.subdir)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`git artifact subdir escapes the clone: ${src.subdir}`)
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`git artifact subdir not found in ${src.org}/${src.repo}#${src.ref}: ${src.subdir}`)
  }
  return resolved
}
