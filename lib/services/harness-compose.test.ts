import { describe, it, expect } from 'vitest'
import { generateStandaloneCompose } from './harness-compose'

describe('generateStandaloneCompose', () => {
  const agentName = 'test-agent'
  const port = 8642
  const dataDir = '/opt/hermes/test-agent'

  describe('non-VPN (default)', () => {
    it('generates compose with hermes service and ports', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir)
      expect(result).toContain(`hermes-${agentName}:`)
      expect(result).toContain(`published: ${port}`)
      expect(result).toContain('target: 8642')
      expect(result).toContain(`container_name: hermes-${agentName}`)
    })

    it('does not include wireguard or camofox', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir)
      expect(result).not.toContain('wireguard')
      expect(result).not.toContain('camofox')
      expect(result).not.toContain('NET_ADMIN')
      expect(result).not.toContain('network_mode')
    })

    it('uses default image when no options provided', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir)
      expect(result).toContain('image: ghcr.io/nimblecoai/hermes-agent:latest')
    })

    it('uses custom image from imageOrBuild', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, {
        imageOrBuild: { image: 'my-registry/hermes:v2' },
      })
      expect(result).toContain('image: my-registry/hermes:v2')
    })

    it('uses build context from imageOrBuild', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, {
        imageOrBuild: { build: '/path/to/source' },
      })
      expect(result).toContain('build:')
      expect(result).toContain('context: /path/to/source')
      expect(result).toContain('dockerfile: Dockerfile')
    })

    it('falls back to defaultImage when imageOrBuild not set', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, {
        defaultImage: 'ghcr.io/nimblecoai/hermes-agent:v1.0',
      })
      expect(result).toContain('image: ghcr.io/nimblecoai/hermes-agent:v1.0')
    })

    it('includes security hardening', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir)
      expect(result).toContain('cap_drop:')
      expect(result).toContain('- ALL')
      expect(result).toContain('read_only: true')
      expect(result).toContain('no-new-privileges')
      expect(result).toContain('memory: 2G')
    })

    it('includes network name', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir)
      expect(result).toContain(`name: hermes-${agentName}`)
    })
  })

  describe('VPN enabled', () => {
    const vpnOpts = { vpnEnabled: true }

    it('includes wireguard service with NET_ADMIN and SYS_MODULE', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain('wireguard:')
      expect(result).toContain('lscr.io/linuxserver/wireguard:latest')
      expect(result).toContain('NET_ADMIN')
      expect(result).toContain('SYS_MODULE')
    })

    it('includes src_valid_mark sysctl', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain('net.ipv4.conf.all.src_valid_mark=1')
    })

    it('includes camofox service with network_mode', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain('camofox:')
      expect(result).toContain('network_mode: "service:wireguard"')
      expect(result).toContain('depends_on:')
    })

    it('includes VNC environment variables on camofox', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain('ENABLE_VNC=true')
      expect(result).toContain('VNC_BIND=0.0.0.0')
      expect(result).toContain('VNC_RESOLUTION=1280x720')
      expect(result).toContain('CAMOFOX_PORT=9377')
    })

    it('maps correct port offsets on wireguard', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      // Agent port
      expect(result).toContain(`published: ${port}`)
      expect(result).toContain('target: 8642')
      // Camofox port (port + 1000)
      expect(result).toContain(`published: ${port + 1000}`)
      expect(result).toContain('target: 9377')
      // VNC port (port + 2000)
      expect(result).toContain(`published: ${port + 2000}`)
      expect(result).toContain('target: 6080')
    })

    it('hermes service has no ports section in VPN mode', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      // The hermes service block should not have its own ports
      const hermesBlock = result.split(`hermes-${agentName}:`).pop()!
      // ports only appear in the wireguard block, not in hermes
      expect(hermesBlock).not.toContain('ports:')
    })

    it('hermes service uses network_mode service:wireguard', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      // Both camofox and hermes should use network_mode
      const matches = result.match(/network_mode: "service:wireguard"/g)
      expect(matches).toHaveLength(2)
    })

    it('uses custom camofox image when provided', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, {
        vpnEnabled: true,
        camofoxImage: 'my-registry/camofox:custom',
      })
      expect(result).toContain('image: my-registry/camofox:custom')
    })

    it('uses default camofox image when not provided', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain('image: ghcr.io/nimblecoai/camofox:latest')
    })

    it('preserves security hardening on hermes service', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain('cap_drop:')
      expect(result).toContain('- ALL')
      expect(result).toContain('read_only: true')
      expect(result).toContain('no-new-privileges')
    })

    it('mounts wg-config volume on wireguard', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain(`${dataDir}/wg-config:/config`)
    })

    it('mounts .camofox volume on camofox', () => {
      const result = generateStandaloneCompose(agentName, port, dataDir, vpnOpts)
      expect(result).toContain(`${dataDir}/.camofox:/data`)
    })
  })

  describe('regression: non-VPN output matches original format', () => {
    it('contains all expected sections in order', () => {
      const result = generateStandaloneCompose('myagent', 8652, '/data/myagent')
      const lines = result.split('\n')
      // Header comment
      expect(lines[0]).toBe('# Generated by hermes-swarm-map — agent: myagent')
      // Services section
      expect(result).toContain('services:')
      expect(result).toContain('hermes-myagent:')
      expect(result).toContain('user: "10000:10000"')
      expect(result).toContain('restart: unless-stopped')
      expect(result).toContain('host.docker.internal:host-gateway')
      expect(result).toContain('/data/myagent/.env')
      expect(result).toContain('published: 8652')
      expect(result).toContain('/data/myagent:/opt/data')
      expect(result).toContain('command: gateway')
      expect(result).toContain('networks:')
      expect(result).toContain('name: hermes-myagent')
    })
  })
})
