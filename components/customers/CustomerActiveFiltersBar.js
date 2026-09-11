'use client'

import { X } from 'lucide-react'

/** Shows applied customer filters as removable chips under the toolbar. */
export default function CustomerActiveFiltersBar({
  chips = [],
  onRemoveChip,
  onClearAll,
}) {
  if (!chips.length) return null

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="text-[12px] font-medium text-muted-foreground">Applied:</span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onRemoveChip?.(chip)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[12px] text-foreground hover:bg-muted/50"
          title={chip.label}
        >
          <span className="truncate">{chip.label}</span>
          <X className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      ))}
      {onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-[12px] font-medium text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Clear all
        </button>
      ) : null}
    </div>
  )
}
