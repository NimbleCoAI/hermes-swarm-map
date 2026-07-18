/**
 * LettaAgentProvider — the "agents-as-API-resources" layer (design §1c).
 *
 * This is NOT a ContainerRuntimeAdapter. A Letta agent has no container, no
 * compose file, no port, no data dir — it is a row in the Letta server's
 * Postgres. This provider wraps the spiked LettaService (REST :8283) and maps
 * each LettaAgent into a `Harness` object so the existing fleet list / detail
 * UI can render Letta agents uniformly, gated by `harness.runtime`.
 *
 * SCOPE (slice 1): read-only. list()/get() only. create/update/remove/message
 * live on later phases (design §3/§4) — the deploy-route Letta branch and the
 * live-server validation, which need a running Letta server to confirm payload
 * shapes. Sending messages is still available through the existing
 * /api/letta/agents/[id]/messages route the spike shipped.
 */

import type { Harness } from '@/lib/types'
import type { LettaService, LettaAgent } from './letta'

/** Stable id for the singleton Letta server harness (the container that hosts agents). */
export const LETTA_SERVER_HARNESS_ID = 'h_letta_server'

/** Prefix for agent harness ids, chosen to not collide with container `h_<name>` ids. */
const AGENT_ID_PREFIX = 'h_letta_'

/** The compose file + service that DockerService drives for the Letta server. */
const LETTA_COMPOSE_FILE = 'docker/letta-compose.yml'
const LETTA_SERVICE_NAME = 'letta'

/** Is this harness id a Letta-runtime id (server or agent)? Cheap sync check for route branching. */
export function isLettaHarnessId(id: string): boolean {
  return id === LETTA_SERVER_HARNESS_ID || id.startsWith(AGENT_ID_PREFIX)
}

/** Recover the raw Letta agent id from a `h_letta_<agentId>` harness id. */
export function lettaAgentIdFromHarnessId(harnessId: string): string {
  return harnessId.startsWith(AGENT_ID_PREFIX)
    ? harnessId.slice(AGENT_ID_PREFIX.length)
    : harnessId
}

/**
 * Map a Letta agent (Postgres row) into a Harness (design §1c table). Container
 * fields that have no per-agent analogue are zeroed/omitted; the UI branches on
 * `runtime === 'letta'` to hide them rather than showing 0% CPU.
 */
export function lettaAgentToHarness(agent: LettaAgent, serverReachable: boolean): Harness {
  const firstBlock = agent.memory_blocks?.find((b) => b.label === 'persona') ?? agent.memory_blocks?.[0]
  return {
    id: AGENT_ID_PREFIX + agent.id,
    name: agent.name ?? agent.id,
    runtime: 'letta',
    // Collapse to reachable/unreachable — an agent has no idle/stopped/restarting.
    status: serverReachable ? 'running' : 'error',
    health: { errors: 0 },
    persona: typeof firstBlock?.value === 'string' ? firstBlock.value : '',
    tier: 'individual',
    // NOT a messaging surface — distinct from Hermes' platform default.
    platform: 'letta',
    channel: '',
    lastSeen: Date.now(),
    models: agent.model ? [agent.model] : [],
    // No per-agent container stats. Sourced later from Letta's usage API (Phase 4).
    costToday: 0,
    invocations: 0,
    cpu: 0,
    mem: 0,
    tools: [],
    // Points at the server's harness — models the server→agents tree (design §4c).
    parentId: LETTA_SERVER_HARNESS_ID,
  }
}

/** The Letta server itself, as a container-backed harness (design §1c "Server-as-a-Harness"). */
export function lettaServerHarness(reachable: boolean): Harness {
  return {
    id: LETTA_SERVER_HARNESS_ID,
    name: 'letta-server',
    runtime: 'letta-server',
    status: reachable ? 'running' : 'stopped',
    health: { errors: 0 },
    persona: 'Letta server — hosts N agents as Postgres rows',
    tier: 'org',
    platform: 'letta',
    channel: ':8283',
    lastSeen: Date.now(),
    models: [],
    costToday: 0,
    invocations: 0,
    cpu: 0,
    mem: 0,
    tools: [],
    // Real compose target — DockerService verbs (start/stop/logs) work on it
    // unchanged (design §1c). Lifecycle WIRING through HarnessService.get() is
    // Phase 2 (get() is sync; this provider is async) — see class note below.
    composeFile: LETTA_COMPOSE_FILE,
    serviceName: LETTA_SERVICE_NAME,
  }
}

export interface AgentResourceProvider {
  runtime: 'letta'
  list(): Promise<Harness[]>
  get(harnessId: string): Promise<Harness | undefined>
  serverHealth(): Promise<{ reachable: boolean }>
}

export class LettaAgentProvider implements AgentResourceProvider {
  readonly runtime = 'letta' as const

  constructor(private readonly letta: LettaService) {}

  /** True if the Letta server answers GET /v1/agents. Doubles as the list fetch. */
  async serverHealth(): Promise<{ reachable: boolean }> {
    try {
      await this.letta.listAgents()
      return { reachable: true }
    } catch {
      return { reachable: false }
    }
  }

  /**
   * The Letta server harness followed by one harness per agent. If the server
   * is unreachable, returns just the server harness (status 'stopped') so the
   * fleet still shows the server tile rather than vanishing.
   */
  async list(): Promise<Harness[]> {
    let agents: LettaAgent[]
    try {
      agents = await this.letta.listAgents()
    } catch {
      return [lettaServerHarness(false)]
    }
    return [
      lettaServerHarness(true),
      ...agents.map((a) => lettaAgentToHarness(a, true)),
    ]
  }

  /** Resolve one Letta harness (server or agent) by its harness id. */
  async get(harnessId: string): Promise<Harness | undefined> {
    if (harnessId === LETTA_SERVER_HARNESS_ID) {
      const { reachable } = await this.serverHealth()
      return lettaServerHarness(reachable)
    }
    if (!harnessId.startsWith(AGENT_ID_PREFIX)) return undefined
    const agentId = lettaAgentIdFromHarnessId(harnessId)
    try {
      const agent = await this.letta.getAgent(agentId)
      return lettaAgentToHarness(agent, true)
    } catch {
      return undefined
    }
  }
}
