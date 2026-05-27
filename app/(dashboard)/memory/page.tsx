'use client'

export default function MemoryPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Memory</h2>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          Fleet-wide memory management is coming in a future release.
        </p>
        <p className="text-xs text-muted-foreground">
          Memory is currently managed per-harness from harness detail pages.
        </p>
      </div>
    </div>
  )
}
