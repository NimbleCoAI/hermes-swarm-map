'use client'

/**
 * SPIKE (Path 1) — read-only "Letta agents" view. See spec §4 steps 2–3.
 *
 * Proves the "agents-as-API-resources" shape distinct from HSM's container
 * model: it lists agents from one Letta *server* (GET /v1/agents), lets you send
 * one message (the single action), and peek at an agent's core-memory blocks.
 * No create/delete UI, no per-agent lifecycle buttons — those don't exist for
 * Letta agents (they're rows in Postgres, not containers).
 */

import { useState } from 'react'
import { useApi } from '@/lib/hooks/use-api'
import { Button } from '@/components/ui/button'
import type { LettaAgent, LettaBlock, LettaMessage } from '@/lib/services/letta'
import { toast } from 'sonner'

/** Best-effort stringify of a Letta message's `content` (spike-loose typing). */
function renderContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : (c as { text?: string })?.text ?? JSON.stringify(c)))
      .join('')
  }
  return content == null ? '' : JSON.stringify(content)
}

function AgentRow({ agent }: { agent: LettaAgent }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState<LettaMessage[] | null>(null)
  const [blocks, setBlocks] = useState<LettaBlock[] | null>(null)
  const [blocksLoading, setBlocksLoading] = useState(false)

  async function send() {
    if (!text.trim()) return
    setSending(true)
    setReply(null)
    try {
      const res = await fetch(`/api/letta/agents/${agent.id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Send failed')
      setReply(json.messages ?? [])
      setText('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Send failed')
    } finally {
      setSending(false)
    }
  }

  async function loadBlocks() {
    setBlocksLoading(true)
    try {
      const res = await fetch(`/api/letta/agents/${agent.id}/blocks`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'Failed to read memory')
      setBlocks(json)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to read memory')
    } finally {
      setBlocksLoading(false)
    }
  }

  return (
    <>
      <tr className="border-b border-[var(--border)] last:border-0 hover:bg-muted/30 transition-colors">
        <td className="px-4 py-3">
          <span className="font-medium">{agent.name ?? agent.id}</span>
        </td>
        <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{agent.id}</td>
        <td className="px-4 py-3 text-muted-foreground">{agent.model ?? '—'}</td>
        <td className="px-4 py-3 text-right">
          <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)}>
            {open ? 'Close' : 'Message'}
          </Button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--border)] last:border-0 bg-muted/20">
          <td colSpan={4} className="px-4 py-4 space-y-3">
            {/* Single action: send a message */}
            <div className="flex items-start gap-2">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Message ${agent.name ?? agent.id}…`}
                rows={2}
                className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm resize-y"
              />
              <Button size="sm" onClick={send} disabled={sending || !text.trim()}>
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </div>

            {reply && (
              <div className="space-y-1.5 text-sm">
                {reply.map((m, i) => (
                  <div key={m.id ?? i} className="rounded-md border border-[var(--border)] px-3 py-2">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">
                      {m.message_type ?? m.role ?? 'message'}
                    </span>
                    <div className="mt-1 whitespace-pre-wrap">{renderContent(m.content)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Read-only peek at core-memory blocks */}
            <div>
              <Button variant="ghost" size="xs" onClick={loadBlocks} disabled={blocksLoading}>
                {blocksLoading ? 'Loading memory…' : blocks ? 'Reload memory blocks' : 'View memory blocks'}
              </Button>
              {blocks && (
                <div className="mt-2 space-y-1.5">
                  {blocks.length === 0 && (
                    <p className="text-xs text-muted-foreground">No memory blocks.</p>
                  )}
                  {blocks.map((b, i) => (
                    <div key={b.id ?? b.label ?? i} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
                      <span className="font-mono text-xs text-accent-foreground">{b.label}</span>
                      <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{b.value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function LettaPage() {
  const { data: agents, loading, error, refetch } = useApi<LettaAgent[]>('/api/letta/agents', 10000)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-2xl font-semibold">Letta agents</h2>
        <Button variant="outline" size="sm" onClick={refetch}>
          Refresh
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mb-6">
        SPIKE (Path 1) · agents on one Letta server (REST :8283), not containers.
      </p>

      {loading && <p className="text-muted-foreground">Loading…</p>}

      {!loading && error && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center space-y-2">
          <p className="text-sm text-destructive">Couldn&apos;t reach the Letta server.</p>
          <p className="text-xs text-muted-foreground">{error}</p>
          <p className="text-xs text-muted-foreground">
            Start it: <code>docker compose -f docker/letta-compose.yml -p letta up -d</code>
          </p>
        </div>
      )}

      {!loading && !error && agents && agents.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No agents yet. Create one via the Letta REST API (POST /v1/agents) or the ADE.
          </p>
        </div>
      )}

      {!loading && !error && agents && agents.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-muted-foreground uppercase tracking-wide">
                <th className="text-left px-4 py-3">Name</th>
                <th className="text-left px-4 py-3">ID</th>
                <th className="text-left px-4 py-3">Model</th>
                <th className="text-right px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <AgentRow key={a.id} agent={a} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
