'use client'

export default function ToolsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-semibold">Tools</h2>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center space-y-3">
        <p className="text-sm text-muted-foreground">
          Tool management with habitat tiers is coming in a future release.
        </p>
        <p className="text-xs text-muted-foreground">
          Tools are currently managed per-harness from harness settings.
        </p>
      </div>
    </div>
  )
}
