import Link from 'next/link'
import type { Harness } from '@/lib/types'
import { StatusDot } from '@/components/shared/status-dot'
import { TierBadge } from '@/components/shared/tier-badge'
import { MessageSquare } from 'lucide-react'

export function HarnessCard({ harness }: { harness: Harness }) {
  return (
    <Link
      href={`/harnesses/${harness.id}`}
      className="flex items-center gap-3 p-3 rounded-lg border border-[var(--border)] hover:bg-muted/50 transition-colors"
    >
      <StatusDot status={harness.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{harness.name}</span>
          <TierBadge tier={harness.tier} />
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {harness.platform}
          </span>
          <span>{harness.models[0]}</span>
        </div>
      </div>
      <div className="text-right text-xs text-muted-foreground">
        <div>{harness.invocations} inv</div>
        <div>${harness.costToday.toFixed(2)}</div>
      </div>
      {harness.health.errors > 0 && (
        <span className="text-xs text-destructive font-medium">
          {harness.health.errors} err
        </span>
      )}
    </Link>
  )
}
