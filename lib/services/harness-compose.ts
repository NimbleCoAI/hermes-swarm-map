/**
 * Standalone Docker Compose generation for Hermes agents.
 * Extracted from harness.ts to support VPN (WireGuard + Camofox) sidecar configuration.
 *
 * NOTE: s6-overlay handles privilege dropping internally — never set `user:` in compose.
 * Required caps: CHOWN, DAC_OVERRIDE, SETGID, SETUID (for s6), NET_BIND_SERVICE (for gateway).
 * Do NOT set read_only, no-new-privileges, or noexec tmpfs — s6 writes executables to /run.
 */

export interface ComposeOptions {
  imageOrBuild?: { image: string } | { build: string }
  defaultImage?: string
  vpnEnabled?: boolean
  camofoxImage?: string
  /**
   * Host interface to bind the human-facing VNC port to. The VNC port (noVNC,
   * container 6080) is used ONLY by a human during CAPTCHA escalation — the
   * agent never connects to it — so binding it to loopback by default keeps it
   * off the LAN/tailnet/internet. Set to a Tailscale IP/hostname to allow remote
   * human escalation. Defaults to '127.0.0.1'.
   */
  vncBindHost?: string
  /**
   * Bundle an optional ollama sidecar that runs a tiny model on CPU, so a
   * brand-new agent can use a local model with zero host setup. OFF by default —
   * host-GPU ollama via host.docker.internal:11434 stays the default and is
   * unaffected. When enabled, an `ollama-<name>` service is emitted that pulls
   * and serves `qwen2.5:0.5b` on boot, and the hermes service waits for it to be
   * healthy. CPU-only (no GPU device reservations).
   *
   * NOTE: reachability differs by variant. Plain: http://ollama-<name>:11434.
   * VPN: http://localhost:11434 (shares the wireguard namespace). Whatever writes
   * OLLAMA_BASE_URL must match the variant.
   */
  bundledOllama?: boolean
  /** Image for the bundled ollama sidecar. Defaults to 'ollama/ollama'. */
  ollamaImage?: string
  /**
   * Per-harness memory limit rendered into the hermes service's
   * `deploy.resources.limits.memory`. Docker-compose memory string (e.g. '2G',
   * '6G', '512M'). Defaults to '2G' when omitted. Memory-heavy harnesses (e.g.
   * Matilde MEG runs) OOM-kill under the default — raise this to fit the job.
   */
  memory?: string
  /**
   * Per-harness CPU limit rendered into the hermes service's
   * `deploy.resources.limits.cpus`. Docker-compose cpu string (e.g. '2.0',
   * '4.0'). Defaults to '2.0' when omitted.
   */
  cpus?: string
}

/** Model the bundled ollama sidecar pulls and serves on boot (tiny, CPU-friendly). */
export const BUNDLED_OLLAMA_MODEL = 'qwen2.5:0.5b'

export function generateStandaloneCompose(
  agentName: string,
  port: number,
  agentDataDir: string,
  options?: ComposeOptions,
): string {
  const { imageOrBuild, defaultImage, vpnEnabled, camofoxImage, vncBindHost, bundledOllama, ollamaImage, memory, cpus } = options ?? {}
  const resolved = imageOrBuild ?? { image: defaultImage || 'ghcr.io/nimblecoai/hermes-agent-mt:latest' }
  const sourceBlock = 'image' in resolved
    ? `    image: ${resolved.image}`
    : `    build:\n      context: ${resolved.build}\n      dockerfile: Dockerfile`

  if (vpnEnabled) {
    return generateVpnCompose(agentName, port, agentDataDir, sourceBlock, camofoxImage, vncBindHost, bundledOllama, ollamaImage, memory, cpus)
  }

  return generatePlainCompose(agentName, port, agentDataDir, sourceBlock, bundledOllama, ollamaImage, memory, cpus)
}

/** Render the hermes service's `deploy.resources.limits` block (8-space indented). */
function resourcesBlock(memory?: string, cpus?: string): string {
  return `    deploy:
      resources:
        limits:
          memory: ${memory ?? '2G'}
          cpus: '${cpus ?? '2.0'}'`
}

/**
 * Render the bundled ollama sidecar service block. CPU-only: no GPU device
 * reservations. Pulls and serves a tiny model on boot via a shell entrypoint
 * (serve in background → wait for ready → pull → wait on serve), and exposes a
 * healthcheck so the hermes service can depend_on it being healthy.
 *
 * `networkBlock` is the network attachment lines (already indented to 4 spaces),
 * empty for the plain default network or the wireguard service-network line for
 * the VPN variant — mirrors how camofox is wired in each variant.
 */
export function ollamaSidecar(
  agentName: string,
  agentDataDir: string,
  ollamaImage: string | undefined,
  networkBlock: string,
): string {
  return `  ollama-${agentName}:
    image: ${ollamaImage || 'ollama/ollama'}
    container_name: ollama-${agentName}
    restart: unless-stopped
${networkBlock}    entrypoint:
      - /bin/sh
      - -c
      - |
        ollama serve &
        until ollama list >/dev/null 2>&1; do sleep 1; done
        ollama pull ${BUNDLED_OLLAMA_MODEL}
        wait
    volumes:
      - ${agentDataDir}/.ollama:/root/.ollama
    healthcheck:
      test: ["CMD-SHELL", "ollama list >/dev/null 2>&1 || wget -qO- http://localhost:11434/api/tags >/dev/null 2>&1"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 60s
`
}

function generatePlainCompose(
  agentName: string,
  port: number,
  agentDataDir: string,
  sourceBlock: string,
  bundledOllama?: boolean,
  ollamaImage?: string,
  memory?: string,
  cpus?: string,
): string {
  // Sidecars share the default (named) network, so the hermes service reaches
  // ollama at http://ollama-<name>:11434 — no network_mode needed.
  const ollamaBlock = bundledOllama
    ? ollamaSidecar(agentName, agentDataDir, ollamaImage, '')
    : ''
  const ollamaDepends = bundledOllama
    ? `    depends_on:\n      ollama-${agentName}:\n        condition: service_healthy\n`
    : ''

  return `# Generated by hermes-swarm-map — agent: ${agentName}
services:
${ollamaBlock}  hermes-${agentName}:
${sourceBlock}
    container_name: hermes-${agentName}
    restart: unless-stopped
${ollamaDepends}    extra_hosts:
      - "host.docker.internal:host-gateway"
    env_file:
      - ${agentDataDir}/.env
    environment:
      # The gateway runs as a non-root user; without HOME it falls back to /root
      # (mode 700) and home-relative credential probes (~/.claude/.credentials.json)
      # raise EACCES → "Provider authentication failed". Pin HOME to the mounted
      # data dir so every agent works regardless of image-level ENV.
      - HOME=/opt/data
      - HERMES_HOME=/opt/data
    ports:
      - published: ${port}
        target: 8642
    volumes:
      - ${agentDataDir}:/opt/data
    command: gateway
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - NET_BIND_SERVICE
      - SETGID
      - SETUID
${resourcesBlock(memory, cpus)}

networks:
  default:
    name: hermes-${agentName}
`
}

function generateVpnCompose(
  agentName: string,
  port: number,
  agentDataDir: string,
  sourceBlock: string,
  camofoxImage?: string,
  vncBindHost: string = '127.0.0.1',
  bundledOllama?: boolean,
  ollamaImage?: string,
  memory?: string,
  cpus?: string,
): string {
  const camofoxPort = port + 1000
  const vncPort = port + 2000

  // Sidecars share the wireguard network namespace (same as camofox), so the
  // hermes service reaches ollama on localhost:11434 inside that namespace.
  // CAVEAT for callers: in VPN mode the bundled ollama is reachable at
  // http://localhost:11434 — NOT http://ollama-<name>:11434. Any env-writer
  // pairing VPN + bundledOllama must set OLLAMA_BASE_URL accordingly. The plain
  // variant (and the create-new deploy path) use the service-name URL. There is
  // currently no VPN+bundled env-writer, so this is a guard against future drift.
  const ollamaNetworkBlock = `    network_mode: "service:wireguard"\n    depends_on:\n      - wireguard\n`
  const ollamaBlock = bundledOllama
    ? '\n' + ollamaSidecar(agentName, agentDataDir, ollamaImage, ollamaNetworkBlock)
    : ''
  // When ollama is bundled the hermes service must wait for it to be healthy.
  // depends_on can't mix list + map form, so emit the map form for both deps.
  const hermesDepends = bundledOllama
    ? `    depends_on:\n      wireguard:\n        condition: service_started\n      ollama-${agentName}:\n        condition: service_healthy\n`
    : `    depends_on:\n      - wireguard\n`

  return `# Generated by hermes-swarm-map — agent: ${agentName} (VPN mode)
services:
  wireguard:
    image: lscr.io/linuxserver/wireguard:latest
    container_name: wireguard-${agentName}
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
      - SYS_MODULE
    sysctls:
      - net.ipv4.conf.all.src_valid_mark=1
    volumes:
      - ${agentDataDir}/wg-config:/config
    ports:
      - published: ${port}
        target: 8642
      - published: ${camofoxPort}
        target: 9377
      # VNC is human-only (CAPTCHA escalation); bind to loopback by default so it
      # is not exposed on the LAN/tailnet. Set vncBindHost to a Tailscale address
      # to allow remote human escalation.
      - host_ip: ${vncBindHost}
        published: ${vncPort}
        target: 6080

  camofox:
    image: ${camofoxImage || 'ghcr.io/nimblecoai/camofox:latest'}
    container_name: camofox-${agentName}
    restart: unless-stopped
    network_mode: "service:wireguard"
    depends_on:
      - wireguard
    environment:
      - CAMOFOX_PORT=9377
      - ENABLE_VNC=true
      - VNC_BIND=0.0.0.0
      - VNC_RESOLUTION=1280x720
    volumes:
      - ${agentDataDir}/.camofox:/data
${ollamaBlock}
  hermes-${agentName}:
${sourceBlock}
    container_name: hermes-${agentName}
    restart: unless-stopped
    network_mode: "service:wireguard"
${hermesDepends}    extra_hosts:
      - "host.docker.internal:host-gateway"
    env_file:
      - ${agentDataDir}/.env
    environment:
      # See generatePlainCompose: pin HOME so non-root credential probes don't
      # hit /root and fail with EACCES ("Provider authentication failed").
      - HOME=/opt/data
      - HERMES_HOME=/opt/data
    volumes:
      - ${agentDataDir}:/opt/data
    command: gateway
    cap_drop:
      - ALL
    cap_add:
      - CHOWN
      - DAC_OVERRIDE
      - NET_BIND_SERVICE
      - SETGID
      - SETUID
${resourcesBlock(memory, cpus)}

networks:
  default:
    name: hermes-${agentName}
`
}

/**
 * Surgically replace the hermes service's source block (`image:` line or
 * `build:` block) with `image: <ref>`, leaving everything else — including any
 * wireguard/camofox sidecar images in the VPN variant — untouched. Relies on
 * generateStandaloneCompose always emitting the source block as the FIRST line
 * inside the `hermes-<name>:` service. Used by the image-update (CD) path.
 */
export function setComposeImage(compose: string, image: string): string {
  const lines = compose.split('\n')
  const svcIdx = lines.findIndex((l) => /^  hermes-[\w.-]+:\s*$/.test(l))
  if (svcIdx < 0 || svcIdx + 1 >= lines.length) {
    throw new Error('setComposeImage: no hermes-<name> service found in compose')
  }
  const srcIdx = svcIdx + 1
  if (/^ {4}image:\s/.test(lines[srcIdx])) {
    lines[srcIdx] = `    image: ${image}`
    return lines.join('\n')
  }
  if (/^ {4}build:\s*$/.test(lines[srcIdx])) {
    let end = srcIdx + 1
    // Consume every line nested under build: — any indent deeper than the
    // 4-space service-key level (context:, dockerfile:, args:, 8-space list
    // items, …). Stops at the next 4-space sibling key or a blank line.
    while (end < lines.length && /^ {5,}\S/.test(lines[end])) end++
    lines.splice(srcIdx, end - srcIdx, `    image: ${image}`)
    return lines.join('\n')
  }
  throw new Error(`setComposeImage: unexpected source block under hermes service: "${lines[srcIdx]}"`)
}

/** Read the hermes service's image ref from a compose string, or null if it's a build: block (local). */
export function readComposeImage(compose: string): string | null {
  const lines = compose.split('\n')
  const svcIdx = lines.findIndex((l) => /^  hermes-[\w.-]+:\s*$/.test(l))
  if (svcIdx < 0 || svcIdx + 1 >= lines.length) return null
  const m = lines[svcIdx + 1].match(/^ {4}image:\s+(\S+)/)
  return m ? m[1] : null
}

/**
 * Read the hermes service's build-context directory from a compose string, or
 * null if it runs from a prebuilt `image:` (no local build).
 *
 * Handles both forms emitted/seen in the wild:
 *   - long form:  `    build:\n      context: /path`
 *   - shorthand:  `    build: /path`
 *
 * This is the actual filesystem source a `--build` reads from, so it's the
 * authoritative thing to git-sync before a rebuild.
 */
export function readComposeBuildContext(compose: string): string | null {
  const lines = compose.split('\n')
  const svcIdx = lines.findIndex((l) => /^  hermes-[\w.-]+:\s*$/.test(l))
  if (svcIdx < 0 || svcIdx + 1 >= lines.length) return null
  const srcLine = lines[svcIdx + 1]

  // Shorthand: `    build: /path`
  const shorthand = srcLine.match(/^ {4}build:\s+(\S.*)$/)
  if (shorthand) return shorthand[1].trim()

  // Long form: `    build:` then a nested `      context: /path`
  if (/^ {4}build:\s*$/.test(srcLine)) {
    for (let i = svcIdx + 2; i < lines.length && /^ {5,}\S/.test(lines[i]); i++) {
      const ctx = lines[i].match(/^ {6,}context:\s+(\S.*)$/)
      if (ctx) return ctx[1].trim()
    }
  }
  return null
}
