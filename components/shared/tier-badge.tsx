import { TIER_COLORS, TIER_LABELS } from '@/lib/constants'
import type { HabitatTier } from '@/lib/types'

export function TierBadge({ tier }: { tier: HabitatTier }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] text-xs font-medium text-white"
      style={{ backgroundColor: TIER_COLORS[tier] }}
    >
      {TIER_LABELS[tier]}
    </span>
  )
}
