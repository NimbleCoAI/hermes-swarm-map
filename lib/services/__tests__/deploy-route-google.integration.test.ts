// @vitest-environment node
//
// Route-level integration test for the Google MCP wiring in POST
// /api/setup/deploy. Same harness as deploy-route.integration.test.ts: Docker,
// the services singleton and os.homedir are mocked; the route's real logic and
// its real fs writes run against temp dirs.
//
// Regression context — a newly created agent's Google MCP could not start, for
// three independent reasons:
//
//   1. GOOGLE_MCP_DIR defaulted only to ~/Documents/GitHub/google-multiplayer-mcp.
//      The repo is commonly cloned as `google-mcp`, so the existsSync probe
//      failed, googleMcpDir became undefined, and the operator who ticked
//      "Google" in the wizard silently got no Google — no mount, no mcp_servers
//      entry, no error.
//   2. The generated config pointed --config at /opt/google/config.yaml. Only
//      /opt/google/tokens is bind-mounted, so that path never existed and the
//      server exited 1 on readFileSync.
//   3. Nothing wrote a Google permission config at all.
//
// And a security constraint that shapes (3): in google-multiplayer-mcp an EMPTY
// `folders` list means NO RESTRICTION (permissions.ts getAllowedFolders), so a
// generated file must default every service to access: none rather than
// granting unscoped access to a whole Google account.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

const h = vi.hoisted(() => ({
  tmpHome: '',
  tmpData: '',
  settings: { useLocalBuild: false, defaultImage: 'ghcr.io/x:latest' } as Record<string, unknown>,
  getDecryptedValue: vi.fn(() => 'sk-ant-api-REALVALUE123'),
  list: vi.fn(() => [] as unknown[]),
  update: vi.fn(),
  setAssignment: vi.fn(),
  add: vi.fn(),
  createOverlay: vi.fn(async () => ({ id: 'h_x' })),
  dockerStart: vi.fn(),
  healthCheck: vi.fn(() => false),
}))

vi.mock('child_process', () => ({ execSync: vi.fn(() => Buffer.from('')) }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const homedir = () => h.tmpHome
  return { ...actual, homedir, default: { ...actual, homedir } }
})

vi.mock('@/lib/services/templates', () => ({ installBaselineTemplates: vi.fn(async () => []) }))
vi.mock('@/lib/services/usecase-templates', () => ({
  getUseCaseTemplate: vi.fn(),
  installUseCaseTemplate: vi.fn(async () => []),
  templateEnabledPlugins: () => [],
}))

vi.mock('@/lib/services', () => ({
  services: {
    docker: { isAvailable: () => true, pullImage: () => ({ ok: true }), healthCheck: h.healthCheck, start: h.dockerStart },
    config: { getSettings: () => ({ ...h.settings, dataDir: h.tmpData }) },
    keys: { getDecryptedValue: h.getDecryptedValue, list: h.list, update: h.update, setAssignment: h.setAssignment, add: h.add },
    harness: { createOverlay: h.createOverlay },
    letta: { listAgents: vi.fn(async () => []), createAgent: vi.fn(), deleteAgent: vi.fn() },
  },
}))

import { POST } from '@/app/api/setup/deploy/route'

function deploy(body: Record<string, unknown>) {
  return POST(new Request('http://localhost/api/setup/deploy', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

/** Minimal reader for the generated permissions file.
 *
 * Deliberately not using a YAML library: this repo declares none (js-yaml is
 * only transitively present in node_modules), and the file we generate is a
 * fixed shape we control. Returns the identity plus every service's access
 * level, so a test can assert on ALL of them rather than a chosen few.
 */
function readPermissions(file: string): { identity: string; access: Record<string, string> } {
  const text = fs.readFileSync(file, 'utf-8')
  const body = text.split('\n').filter((l) => !l.trimStart().startsWith('#'))
  const identity = body.find((l) => /^\s*identity:/.test(l))?.split(':')[1]?.trim() ?? ''
  const access: Record<string, string> = {}
  let service = ''
  for (const line of body) {
    const svc = line.match(/^ {4}(\w+):\s*$/)
    if (svc) { service = svc[1]; continue }
    const acc = line.match(/^ {6}access:\s*(\S+)\s*$/)
    if (acc && service) access[service] = acc[1]
  }
  return { identity, access }
}

/** Create a fake *built* google-mcp checkout under the mocked home. */
function makeGoogleCheckout(dirName: string) {
  const dir = path.join(h.tmpHome, 'Documents', 'GitHub', dirName)
  fs.mkdirSync(path.join(dir, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'dist', 'index.js'), '// built bundle\n')
  return dir
}

const BASE = {
  provider: 'anthropic',
  primaryModel: 'claude-opus-4-6',
  llmKey: 'sk-ant-api-X',
}

function agentDir(slug: string) {
  return path.join(h.tmpHome, `.hermes-${slug}`)
}

describe('POST /api/setup/deploy — Google MCP wiring', () => {
  beforeEach(() => {
    h.tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gdeploy-home-'))
    h.tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'gdeploy-data-'))
    h.settings = { useLocalBuild: false, defaultImage: 'ghcr.io/x:latest' }
    delete process.env.GOOGLE_MCP_DIR
    vi.mocked(h.dockerStart).mockClear()
  })

  afterEach(() => {
    fs.rmSync(h.tmpHome, { recursive: true, force: true })
    fs.rmSync(h.tmpData, { recursive: true, force: true })
    delete process.env.GOOGLE_MCP_DIR
  })

  // --- defect 1: the short checkout name must be found -------------------

  it.each(['google-multiplayer-mcp', 'google-mcp'])(
    'finds a built checkout named %s',
    async (dirName) => {
      makeGoogleCheckout(dirName)

      const res = await deploy({ ...BASE, name: 'gm', googleEnabled: true })
      expect((await res.json()).ok).toBe(true)

      const cfg = fs.readFileSync(path.join(agentDir('gm'), 'config.yaml'), 'utf-8')
      expect(cfg).toContain('google:')
      expect(cfg).toContain('/opt/google-multiplayer-mcp/dist/index.js')
    },
  )

  it('fails loudly when Google is enabled but no built checkout exists', async () => {
    // No checkout created at all.
    const res = await deploy({ ...BASE, name: 'gmissing', googleEnabled: true })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/google-multiplayer-mcp/i)
    expect(body.error).toMatch(/GOOGLE_MCP_DIR|npm run build/i)
    // Silently deploying an agent whose Google integration does not exist is
    // the bug — the operator ticked the box.
    expect(h.dockerStart).not.toHaveBeenCalled()
  })

  it('treats an unbuilt checkout as missing (dist/index.js absent)', async () => {
    fs.mkdirSync(path.join(h.tmpHome, 'Documents', 'GitHub', 'google-mcp'), { recursive: true })

    const res = await deploy({ ...BASE, name: 'gunbuilt', googleEnabled: true })
    expect(res.status).toBe(400)
  })

  it('honours an explicit GOOGLE_MCP_DIR override', async () => {
    const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'gcustom-'))
    fs.mkdirSync(path.join(custom, 'dist'), { recursive: true })
    fs.writeFileSync(path.join(custom, 'dist', 'index.js'), '//\n')
    process.env.GOOGLE_MCP_DIR = custom

    const res = await deploy({ ...BASE, name: 'gover', googleEnabled: true })
    expect((await res.json()).ok).toBe(true)
    fs.rmSync(custom, { recursive: true, force: true })
  })

  // --- defect 2: --config must point at a path that is actually mounted ---

  it('points --config at the mounted data dir, not /opt/google', async () => {
    makeGoogleCheckout('google-mcp')
    await deploy({ ...BASE, name: 'gcfg', googleEnabled: true })

    const cfg = fs.readFileSync(path.join(agentDir('gcfg'), 'config.yaml'), 'utf-8')
    expect(cfg).toContain('/opt/data/google-permissions.yaml')
    expect(cfg).not.toContain('/opt/google/config.yaml')
  })

  // --- defect 3: the permission file must exist, and be safe -------------

  it('writes a permission config the server can read', async () => {
    makeGoogleCheckout('google-mcp')
    await deploy({ ...BASE, name: 'gperm', googleEnabled: true })

    const p = path.join(agentDir('gperm'), 'google-permissions.yaml')
    expect(fs.existsSync(p)).toBe(true)

    const { identity, access } = readPermissions(p)
    // google-multiplayer-mcp throws without google.identity.
    expect(identity).toBe('gperm')
    expect(Object.keys(access).length).toBeGreaterThan(0)
  })

  it('grants NOTHING by default — empty folders means unrestricted', async () => {
    makeGoogleCheckout('google-mcp')
    await deploy({ ...BASE, name: 'gsafe', googleEnabled: true })

    const { access } = readPermissions(
      path.join(agentDir('gsafe'), 'google-permissions.yaml'),
    )
    expect(Object.keys(access).length).toBeGreaterThanOrEqual(4)

    for (const [service, level] of Object.entries(access)) {
      expect(
        level,
        `${service} must default to none: an empty folders list means NO ` +
          'restriction, so any other default hands a brand-new agent the ' +
          'whole Google account',
      ).toBe('none')
    }
  })

  it('creates the google-tokens dir so the OAuth flow can write into it', async () => {
    makeGoogleCheckout('google-mcp')
    await deploy({ ...BASE, name: 'gtok', googleEnabled: true })

    const dir = path.join(agentDir('gtok'), 'google-tokens')
    expect(fs.existsSync(dir)).toBe(true)
    expect(fs.statSync(dir).isDirectory()).toBe(true)
  })

  it('accepts an explicit identity so it can match an existing token file', async () => {
    makeGoogleCheckout('google-mcp')
    await deploy({ ...BASE, name: 'gid', googleEnabled: true, googleIdentity: 'frontdoor' })

    expect(readPermissions(path.join(agentDir('gid'), 'google-permissions.yaml')).identity)
      .toBe('frontdoor')
  })

  // --- Google off: nothing google-shaped is emitted ----------------------

  it('writes no Google artifacts when Google is not enabled', async () => {
    makeGoogleCheckout('google-mcp')  // present but unused
    await deploy({ ...BASE, name: 'goff' })

    const dir = agentDir('goff')
    expect(fs.existsSync(path.join(dir, 'google-permissions.yaml'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'google-tokens'))).toBe(false)
    const cfg = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8')
    expect(cfg).not.toContain('google-multiplayer-mcp')
  })

  // --- the web backend the searches actually use --------------------------

  it('pins search_backend so it is not auto-detected from .env ordering', async () => {
    await deploy({ ...BASE, name: 'gweb' })

    const cfg = fs.readFileSync(path.join(agentDir('gweb'), 'config.yaml'), 'utf-8')
    expect(cfg).toContain('search_backend: brave-free')
    expect(cfg).toContain('extract_backend: firecrawl')
    // 'brave' is not a registered provider name; it resolves to nothing and the
    // runtime silently falls back to a different provider.
    expect(cfg).not.toMatch(/search_backend:\s*brave\s*$/m)
  })
})
