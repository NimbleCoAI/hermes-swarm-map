// @vitest-environment node
//
// Proves DockerService no longer routes commands through a shell (findings
// F1–F5). Each sink is called with a value containing shell metacharacters that
// would execute an injected `touch <sentinel>` IF the command were built by
// string interpolation and run via /bin/sh. With an argv-based execFile there is
// no shell, so the metacharacters are an inert part of a single argument and the
// sentinel is never created. These tests spawn a real `docker` process (which
// fails fast — the point is purely whether the injected command runs).
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { DockerService } from '../docker'

const docker = new DockerService()
const sentinels: string[] = []

function sentinelPath(tag: string): string {
  const p = path.join(os.tmpdir(), `hsm-injection-${tag}-${process.pid}`)
  fs.rmSync(p, { force: true })
  sentinels.push(p)
  return p
}

afterEach(() => {
  for (const p of sentinels.splice(0)) fs.rmSync(p, { force: true })
})

describe('DockerService is shell-free (F1–F5)', () => {
  it('listContainers does not execute an injected command via composeFile (F1)', () => {
    const sentinel = sentinelPath('ls')
    // `; touch <sentinel> #` would be a second shell command if a shell parsed it.
    docker.listContainers(`/nonexistent.yml; touch ${sentinel} #`)
    expect(fs.existsSync(sentinel)).toBe(false)
  })

  it('pullImage does not execute an injected command via image (F4)', () => {
    const sentinel = sentinelPath('pull')
    docker.pullImage(`busybox; touch ${sentinel} #`)
    expect(fs.existsSync(sentinel)).toBe(false)
  })

  it('getLogs does not execute an injected command via composeFile/service', () => {
    const sentinel = sentinelPath('logs')
    docker.getLogs(`/nonexistent.yml`, `svc; touch ${sentinel} #`)
    expect(fs.existsSync(sentinel)).toBe(false)
  })

  it('start does not execute an injected command via service', () => {
    const sentinel = sentinelPath('start')
    try {
      docker.start(`/nonexistent.yml`, `svc; touch ${sentinel} #`)
    } catch {
      /* start throws on docker failure — irrelevant; we only care about the sentinel */
    }
    expect(fs.existsSync(sentinel)).toBe(false)
  })
})
