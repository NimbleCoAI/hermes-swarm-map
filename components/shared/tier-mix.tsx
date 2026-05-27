import { TIER_COLORS, TIER_ORDER } from '@/lib/constants'
import type { HabitatTier } from '@/lib/types'

export function TierMix({ tiers }: { tiers: HabitatTier[] }) {
  const unique = TIER_ORDER.filter((t) => tiers.includes(t))
  const touchesPublic = unique.includes('public')

  return (
    <div
      className={`inline-flex gap-0.5 ${touchesPublic ? 'ring-1 ring-[var(--warning)] rounded-sm p-0.5' : ''}`}
      title={unique.join(', ')}
    >
      {unique.map((tier) => (
        <span
          key={tier}
          className="block h-3 w-3 rounded-[2px]"
          style={{ backgroundColor: TIER_COLORS[tier] }}
        />
      ))}
    </div>
  )
}
