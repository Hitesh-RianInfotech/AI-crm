'use client'

import { cn } from '@/lib/utils'
import { sanitizeStatusHex } from '@/lib/status-hex'

export default function StatusColorBadge({ color, className, children }) {
  const hex = sanitizeStatusHex(color)
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full leading-none',
        hex ? 'status-color-badge' : 'bg-muted text-foreground',
        className
      )}
      style={hex ? { '--status-color': hex } : undefined}
    >
      {children}
    </span>
  )
}
