'use client'

/**
 * Read-only detail view for a Letta harness (agent or server). Slice 1 of the
 * Letta fork (design §4a): the container-shaped Hermes detail page has no
 * meaning for a Postgres-row agent, so we render a dedicated degraded view
 * instead of threading `runtime === 'letta'` branches through the 1800-line
 * Hermes page.
 *
 * What degrades to what (design §4a):
 *   Lifecycle buttons  → Send message (Reset/Delete deferred to a later phase)
 *   Overview CPU/mem    → model handle + agent identity
 *   Logs tab            → message / turn viewer (send + rendered reply)
 *   Memory rows         → core-memory block viewer (the airlock's key surface)
 *
 * Everything here is read-only except "send a message" (which the spike route
 * already supports). Create/update/reset need a live Letta server (Phase 4).
 */

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { StatusDot } from '@/components/shared/status-dot'
import { useApi } from '@/lib/hooks/use-api'
import type { Harness } from '@/lib/types'
import type { LettaBlock, LettaMessage } from '@/lib/services/letta'
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

/** Strip the `h_letta_` prefix to recover the raw Letta agent id for the spike routes. */
function agentIdFromHarnessId(id: string): string {
  return id.startsWith('h_letta_') ? id.slice('h_letta_'.length) : id
}

export function LettaAgentDetail({ harness }: { harness: Harness }) {
  const isServer = harness.runtime === 'letta-server'
  const agentId = agentIdFromHarnessId(harness.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/harnesses" className="text-sm text-muted-foreground hover:underline">
          ← Harnesses
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <StatusDot status={harness.status ?? 'stopped'} />
        <h2 className="text-2xl font-semibold">{harness.name}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground uppercase tracking-wide">
          {harness.runtime}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {isServer
          ? 'Letta server (a real container). Hosts N agents as Postgres rows — start/stop/logs via Docker are available on the server, agents are managed over REST.'
          : 'Letta agent — a row in the Letta server’s Postgres, not a container. No CPU/memory, no lifecycle buttons; managed over REST.'}
      </p>

      {/* Overview: model handle + identity, not CPU/mem (design §4a) */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="text-sm font-semibold mb-2">Overview</h3>
        <Row label="Runtime" value={harness.runtime} />
        <Row label="Status" value={harness.status === 'running' ? 'reachable' : harness.status} />
        {!isServer && <Row label="Model handle" value={harness.models?.[0] ?? '—'} />}
        {!isServer && <Row label="Agent ID" value={<span className="font-mono text-xs">{agentId}</span>} />}
        {isServer && <Row label="Service" value={<span className="font-mono text-xs">{harness.serviceName}</span>} />}
        {isServer && <Row label="Endpoint" value={<span className="font-mono text-xs">{harness.channel || ':8283'}</span>} />}
      </section>

      {isServer ? (
        <ServerAgentsList />
      ) : (
        <>
          <MemoryBlocks agentId={agentId} />
          <MessageViewer agentId={agentId} name={harness.name} />
        </>
      )}
    </div>
  )
}

function ServerAgentsList() {
  // Server-hosted agents, for the server view's child list (design §4c tree).
  const { data: fleet } = useApi<Harness[]>('/api/letta/harnesses')
  const children = (fleet ?? []).filter((h) => h.runtime === 'letta')
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold mb-2">Hosted agents ({children.length})</h3>
      {children.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents on this server yet.</p>
      ) : (
        <ul className="space-y-1">
          {children.map((c) => (
            <li key={c.id}>
              <Link href={`/harnesses/${c.id}`} className="flex items-center gap-2 text-sm hover:underline">
                <StatusDot status={c.status ?? 'stopped'} />
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">{c.models?.[0] ?? '—'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Core-memory block viewer — the single most important Letta-native surface (design §4a). */
function MemoryBlocks({ agentId }: { agentId: string }) {
  const { data: blocks, loading, error } = useApi<LettaBlock[]>(`/api/letta/agents/${agentId}/blocks`)
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold mb-2">Memory blocks</h3>
      <p className="text-xs text-muted-foreground mb-3">
        Read-only in slice 1. Editing (the airlock&apos;s <code>shareable</code> block) lands with the live server.
      </p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm text-destructive">Couldn&apos;t read memory: {error}</p>}
      {blocks && blocks.length === 0 && <p className="text-sm text-muted-foreground">No memory blocks.</p>}
      {blocks && blocks.length > 0 && (
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div key={b.id ?? b.label ?? i} className="rounded-md border border-[var(--border)] px-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-accent-foreground">{b.label}</span>
                {typeof b.limit === 'number' && (
                  <span className="text-xs text-muted-foreground">limit {b.limit}</span>
                )}
              </div>
              <div className="mt-1 whitespace-pre-wrap text-muted-foreground">{b.value}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Message / turn viewer — replaces the container Logs tab (design §4a). */
function MessageViewer({ agentId, name }: { agentId: string; name: string }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState<LettaMessage[] | null>(null)

  async function send() {
    if (!text.trim()) return
    setSending(true)
    setReply(null)
    try {
      const res = await fetch(`/api/letta/agents/${agentId}/messages`, {
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

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-sm font-semibold mb-2">Messages</h3>
      <div className="flex items-start gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Message ${name}…`}
          rows={2}
          className="flex-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm resize-y"
        />
        <Button size="sm" onClick={send} disabled={sending || !text.trim()}>
          {sending ? 'Sending…' : 'Send'}
        </Button>
      </div>
      {reply && (
        <div className="mt-3 space-y-1.5 text-sm">
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
    </section>
  )
}
