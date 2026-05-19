'use client'

import { useState } from 'react'
import { TIER_COLORS, TIER_LABELS, TIER_DESCRIPTIONS, TIER_ORDER } from '@/lib/constants'
import type { HabitatTier, Tool } from '@/lib/types'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'

type TierSelectProps = {
  harnessId: string
  currentTier: HabitatTier
  tools?: Tool[]
  onTierChanged: (newTier: HabitatTier) => void
}

export function TierSelect({ harnessId, currentTier, tools, onTierChanged }: TierSelectProps) {
  const [saving, setSaving] = useState(false)

  async function handleChange(newTier: HabitatTier) {
    if (newTier === currentTier) return

    // Check for tool tier mismatches
    const mismatchedTools = tools?.filter(
      (t) => t.allowedTiers.length > 0 && !t.allowedTiers.includes(newTier)
    ) ?? []

    if (mismatchedTools.length > 0) {
      const names = mismatchedTools.map((t) => t.name).join(', ')
      toast.warning(
        `${mismatchedTools.length} tool${mismatchedTools.length > 1 ? 's' : ''} may not match the "${TIER_LABELS[newTier]}" tier: ${names}`,
        { duration: 5000 }
      )
    }

    // Optimistic update
    onTierChanged(newTier)
    setSaving(true)

    try {
      const res = await fetch(`/api/harnesses/${harnessId}/tier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: newTier }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'Failed to update tier')
        // Revert on failure
        onTierChanged(currentTier)
        return
      }

      toast.success(`Tier updated to ${TIER_LABELS[newTier]}`)
    } catch {
      toast.error('Network error updating tier')
      onTierChanged(currentTier)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Select value={currentTier} onValueChange={(val) => handleChange(val as HabitatTier)} disabled={saving}>
      <SelectTrigger
        size="sm"
        className="h-6 gap-1 border-none px-2 py-0.5 text-xs font-medium text-white hover:opacity-90 cursor-pointer"
        style={{ backgroundColor: TIER_COLORS[currentTier] }}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {TIER_ORDER.map((tier) => (
          <SelectItem key={tier} value={tier}>
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: TIER_COLORS[tier] }}
                />
                <span className="font-medium">{TIER_LABELS[tier]}</span>
              </div>
              <span className="text-xs text-muted-foreground pl-4">
                {TIER_DESCRIPTIONS[tier]}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
