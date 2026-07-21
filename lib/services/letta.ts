/**
 * SPIKE ARTIFACT — Letta runtime (Path 1). See spec §2 / §4 and finding
 * 2026-07-06-swarm-map-managing-letta-agents.md.
 *
 * The "agents-as-API-resources" layer, deliberately DISTINCT from the container
 * model. HSM manages the Letta *server* as a container via DockerService
 * (docker/letta-compose.yml); this talks to that server's REST API on :8283 to
 * CRUD/message individual agents — which have no container of their own (they're
 * rows in Postgres). None of HSM's per-agent container verbs (start/stop/
 * restart) apply here; create/message/read-memory over REST is the whole model.
 *
 * Intentionally thin and loosely typed — this is a spike to feel the shape, not
 * a hardened SDK. Response types are `Record`/`unknown`-ish on purpose; a real
 * build would generate types from Letta's OpenAPI spec.
 *
 * Endpoints verified against docs.letta.com (2026-07-18):
 *   GET    /v1/agents                     list agents
 *   POST   /v1/agents                     create agent
 *   GET    /v1/agents/{id}                get one agent
 *   POST   /v1/agents/{id}/messages       send a message (returns the turn)
 *   GET    /v1/agents/{id}/blocks         list core-memory blocks
 * (The blocks path is the CURRENT shape; older docs showed
 *  /v1/agents/{id}/core-memory/blocks. This uses the current one.)
 */

/** A Letta memory block — the native "expose this slice, hide that" granularity. */
export interface LettaBlock {
  id?: string
  label: string
  value: string
  limit?: number
  description?: string
  [k: string]: unknown
}

/** A Letta agent (rows in Postgres). Loosely typed — spike. */
export interface LettaAgent {
  id: string
  name: string
  created_at?: string
  last_updated_at?: string
  model?: string
  memory_blocks?: LettaBlock[]
  [k: string]: unknown
}

/** One message in a turn's response. Letta returns typed messages, not one blob. */
export interface LettaMessage {
  id?: string
  message_type?: string // user_message | assistant_message | reasoning_message | tool_call_message | ...
  content?: unknown
  role?: string
  date?: string
  [k: string]: unknown
}

/** Response envelope for POST .../messages. */
export interface LettaMessageResponse {
  messages: LettaMessage[]
  usage?: Record<string, unknown>
  stop_reason?: string
  [k: string]: unknown
}

/** Minimal create payload. Letta defaults most of this. */
export interface CreateAgentConfig {
  name: string
  /**
   * Agent architecture. `letta_v1_agent` is the modern memfs agent (memory
   * projected into git-backed context-repo files, edited via filesystem tools);
   * `memgpt_agent` is the LEGACY memory-blocks architecture. Letta's team flagged
   * memory_blocks as "a very old style" (2026-07 feedback) — default to the
   * modern type. See www.letta.com/blog/our-next-phase.
   */
  agent_type?: string
  /** e.g. "anthropic/claude-3-5-sonnet-20241022" — a provider-independent handle. */
  model?: string
  /** Optional embedding handle, e.g. "openai/text-embedding-3-small". */
  embedding?: string
  /**
   * LEGACY (memgpt_agent only): core-memory blocks the agent boots with. Under
   * memfs these become files in the agent's context repo instead — do not use
   * for modern agents. Retained for the airlock `shareable`-block path until its
   * memfs mapping is validated live (Phase 4).
   */
  memory_blocks?: LettaBlock[]
  system?: string
  [k: string]: unknown
}

/**
 * Base URL of the Letta server. Defaults to the compose-published :8283.
 * Server-wide config (provider keys, tool sandbox) lives on the server itself,
 * not here — this client only speaks agent-resource REST.
 */
const DEFAULT_BASE_URL = 'http://localhost:8283'

export class LettaService {
  private readonly baseUrl: string

  constructor(baseUrl?: string) {
    this.baseUrl =
      (baseUrl ?? process.env.LETTA_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  }

  /** Whether a base URL is configured. (There's no cheap sync reachability check.) */
  isConfigured(): boolean {
    return this.baseUrl.length > 0
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers ?? {}),
        },
        // Server-side calls only; no caching of live agent state.
        cache: 'no-store',
      })
    } catch (err) {
      // Connection refused etc. — the server container probably isn't up.
      throw new Error(
        `Letta server unreachable at ${this.baseUrl} — is the letta container running? (${err instanceof Error ? err.message : String(err)})`,
      )
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Letta ${init?.method ?? 'GET'} ${path} failed: ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`)
    }

    // DELETE and some endpoints may return empty bodies.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  /**
   * GET /v1/agents — list agents on the server. Pass `{ name }` to use the
   * server-side exact-match filter (`?name=`) instead of listing everything —
   * the reliable way to check name existence, since a bare list is paginated
   * (bounded default limit) and would miss a collision past the first page.
   */
  async listAgents(opts?: { name?: string }): Promise<LettaAgent[]> {
    const qs = opts?.name ? `?name=${encodeURIComponent(opts.name)}` : ''
    return this.request<LettaAgent[]>(`/v1/agents${qs}`)
  }

  /** GET /v1/agents/{id} — one agent's full state. */
  async getAgent(id: string): Promise<LettaAgent> {
    return this.request<LettaAgent>(`/v1/agents/${encodeURIComponent(id)}`)
  }

  /** POST /v1/agents — create an agent (memory-first: pass memory_blocks). */
  async createAgent(cfg: CreateAgentConfig): Promise<LettaAgent> {
    return this.request<LettaAgent>('/v1/agents', {
      method: 'POST',
      body: JSON.stringify(cfg),
    })
  }

  /**
   * POST /v1/agents/{id}/messages — send one user message, get the full turn
   * back (reasoning + assistant + any tool messages).
   *
   * NOTE (serialization): Letta processes an agent's messages sequentially. A
   * real control plane must serialize per-agent sends; this spike does not.
   */
  async sendMessage(id: string, text: string): Promise<LettaMessageResponse> {
    return this.request<LettaMessageResponse>(
      `/v1/agents/${encodeURIComponent(id)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ role: 'user', content: text }],
        }),
      },
    )
  }

  /**
   * GET /v1/agents/{id}/blocks — the agent's core-memory blocks. This is the
   * granularity the "Librarian in an Airlock" use-case hangs on (one curated
   * `shareable` block, the rest private).
   */
  async getMemoryBlocks(id: string): Promise<LettaBlock[]> {
    return this.request<LettaBlock[]>(`/v1/agents/${encodeURIComponent(id)}/blocks`)
  }
}
