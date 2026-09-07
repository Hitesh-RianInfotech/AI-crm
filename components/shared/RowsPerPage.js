'use client'

import { Select } from '@/components/ui/select'

const DEFAULT_OPTIONS = [10, 25, 50, 100]

/**
 * "Rows [ 50 v ]" page-size selector for paginated list views.
 * Controlled — parent owns the value and resets to page 1 on change.
 */
export function RowsPerPage({ value, onChange, options = DEFAULT_OPTIONS, disabled }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      Rows
      <Select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-[72px] pr-8 text-[13px] text-foreground"
      >
        {options.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
    </label>
  )
}
