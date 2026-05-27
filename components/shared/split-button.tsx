'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Loader2 } from 'lucide-react'

type SplitButtonProps = {
  label: string
  loadingLabel?: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  items: { label: string; description?: string; onClick: () => void }[]
}

export function SplitButton({ label, loadingLabel, onClick, disabled, loading, items }: SplitButtonProps) {
  return (
    <div className="inline-flex">
      <Button onClick={onClick} disabled={disabled || loading} className="rounded-r-none" size="sm">
        {loading ? (
          <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />{loadingLabel ?? label}</>
        ) : label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={disabled || loading}
          className="inline-flex shrink-0 items-center justify-center rounded-l-none rounded-r-[min(var(--radius-md),12px)] border border-transparent bg-primary px-1.5 text-primary-foreground transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 h-7 border-l border-l-white/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {items.map((item) => (
            <DropdownMenuItem key={item.label} onClick={item.onClick}>
              <div>
                <div className="font-medium">{item.label}</div>
                {item.description && (
                  <div className="text-xs text-muted-foreground">{item.description}</div>
                )}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
