/**
 * Regression tests for the signal-cli daemon deploy.
 *
 * The daemon is defined once in infra/signal-cli/docker-compose.yml and deployed
 * via renderDeployedCompose(). Background: signal-cli runs in JSON-RPC daemon
 * mode (no REST /v1/about endpoint — it 404s). A stale duplicate compose string
 * in this route had drifted to the wrong image (bbernhard) with a /v1/about
 * healthcheck, so the daemon was permanently "unhealthy" and had no autoheal.
 */

import { describe, it, expect } from 'vitest'
import { renderDeployedCompose } from './route'

describe('signal-cli deploy compose (rendered from infra source of truth)', () => {
  const compose = renderDeployedCompose()

  it('does not use the bbernhard REST image', () => {
    expect(compose).not.toContain('bbernhard')
  })

  it('does not probe the non-existent REST /v1/about endpoint', () => {
    expect(compose).not.toContain('localhost:8080/v1/about')
  })

  it('healthchecks via the JSON-RPC endpoint with listAccounts', () => {
    expect(compose).toContain('/api/v1/rpc')
    expect(compose).toContain('listAccounts')
  })

  it('embeds a valid JSON-RPC healthcheck payload', () => {
    const match = compose.match(/-d '(\{.*?\})'/)
    expect(match).not.toBeNull()
    const payload = JSON.parse((match as RegExpMatchArray)[1].replace(/\\"/g, '"'))
    expect(payload.method).toBe('listAccounts')
    expect(payload.jsonrpc).toBe('2.0')
  })

  it('pins the build context to an absolute path (no relative build: .)', () => {
    expect(compose).toMatch(/context: \/.*infra\/signal-cli/)
    expect(compose).not.toMatch(/^\s*build: \.\s*$/m)
  })

  it('deploys an autoheal sidecar scoped to the daemon only', () => {
    expect(compose).toContain('signal-cli-autoheal')
    expect(compose).toContain('willfarrell/autoheal')
    // Scoped via label so it never restarts agent harness containers.
    expect(compose).toContain('AUTOHEAL_CONTAINER_LABEL=autoheal')
    expect(compose).toContain('autoheal=true')
  })
})
