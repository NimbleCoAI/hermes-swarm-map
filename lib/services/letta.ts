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
 * Endpoints verified against docs.letta.com (blocks/files re-verified 2026-07-21):
 *   GET    /v1/agents                          list agents
 *   POST   /v1/agents                          create agent
 *   GET    /v1/agents/{id}                      get one agent
 *   POST   /v1/agents/{id}/messages             send a message (returns the turn)
 *   GET    /v1/agents/{id}/core-memory/blocks   list core-memory blocks
 *   GET    /v1/agents/{id}/files                memfs context-file view
 * (CORRECTION: the spike used /v1/agents/{id}/blocks, which does NOT exist — the
 *  real path is under /core-memory. Confirmed against the API reference.)
 */

/**
 * A Letta core-memory block. Under memfs these project into files
 * (`system/persona.md` etc.) but the block REST surface remains the read/seed
 * path. Fields per the confirmed Block schema (docs.letta.com, 2026-07-21).
 * NOTE: `read_only` is flagged deprecated in the current Block schema — treat as
 * advisory, confirm longevity against a live server before relying on it.
 */
export interface LettaBlock {
  id?: string
  label: string
  value: string
  limit?: number
  description?: string
  hidden?: boolean
  read_only?: boolean
  metadata?: Record<string, unknown>
  tags?: string[]
  [k: string]: unknown
}

/**
 * A file in a memfs agent's live context view (`GET /v1/agents/{id}/files`).
 * `is_open` = currently loaded into context; `visible_content` = the open slice.
 * This is the memfs "what's in context right now" surface.
 */
export interface LettaFile {
  file_id?: string
  file_name?: string
  folder_id?: string
  is_open?: boolean
  visible_content?: string
  start_line?: number
  end_line?: number
  last_accessed_at?: string
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
   * DELETE /v1/agents/{id} — remove an agent (a Postgres row on the server).
   * Used by the deploy route to clean up a freshly created brain when the
   * door phase of a linked-pair deploy fails — otherwise the orphaned name
   * 409-blocks every retry of the same deploy.
   */
  async deleteAgent(id: string): Promise<void> {
    await this.request<void>(`/v1/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
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
   * GET /v1/agents/{id}/core-memory/blocks — the agent's core-memory blocks.
   * (The spike used `/v1/agents/{id}/blocks`, which does not exist — the real
   * path is under `/core-memory`, confirmed against docs.letta.com 2026-07-21.)
   */
  async getMemoryBlocks(id: string): Promise<LettaBlock[]> {
    return this.request<LettaBlock[]>(`/v1/agents/${encodeURIComponent(id)}/core-memory/blocks`)
  }

  /**
   * GET /v1/agents/{id}/files — the agent's live context-file view (memfs).
   * Pass `{ isOpen: true }` to list only files currently loaded into context.
   * `limit` is capped at 200 by the server.
   *
   * The endpoint returns a PAGINATED ENVELOPE `{ files, next_cursor, has_more }`
   * (confirmed live 2026-07-21 against self-hosted letta/letta) — NOT a bare
   * array like /core-memory/blocks. We unwrap to the files array, tolerating a
   * bare-array response from a future/older server shape.
   */
  async listFiles(id: string, opts?: { isOpen?: boolean; limit?: number }): Promise<LettaFile[]> {
    const qs = new URLSearchParams()
    if (opts?.isOpen !== undefined) qs.set('is_open', String(opts.isOpen))
    if (opts?.limit !== undefined) qs.set('limit', String(opts.limit))
    const suffix = qs.toString() ? `?${qs.toString()}` : ''
    const resp = await this.request<{ files?: LettaFile[] } | LettaFile[]>(
      `/v1/agents/${encodeURIComponent(id)}/files${suffix}`,
    )
    return Array.isArray(resp) ? resp : (resp?.files ?? [])
  }
}
