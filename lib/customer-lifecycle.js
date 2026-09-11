/**
 * Customer lifecycle statuses (trial + student phase).
 * Keys stay trial_* for compatibility; labels use Trial.
 * Keep in sync with backend CUSTOMER_LIFECYCLE_STATUS_META.
 */

import { sanitizeStatusHex } from '@/lib/status-hex'

export const CUSTOMER_LIFECYCLE_STATUS_META = [
  {
    value: 'trial_unscheduled',
    label: 'Trial Unscheduled',
    phase: 'intro',
    description: 'First purchase / convert done. Trial lesson not booked yet.',
    color: '#F59E0B',
  },
  {
    value: 'trial_scheduled',
    label: 'Trial Scheduled',
    phase: 'intro',
    description: 'Trial lesson is on the calendar.',
    color: '#0EA5E9',
  },
  {
    value: 'trial_no_show',
    label: 'Trial No-Show',
    phase: 'intro',
    description: 'Missed the scheduled trial lesson.',
    color: '#F97316',
  },
  {
    value: 'no_sale',
    label: 'No Sale',
    phase: 'intro',
    description: 'Attended trial but has not bought a program yet.',
    color: '#8B5CF6',
  },
  {
    value: 'active',
    label: 'Active',
    phase: 'student',
    description: 'Bought a program / package again — active student.',
    color: '#059669',
  },
  {
    value: 'inactive',
    label: 'Inactive',
    phase: 'student',
    description: 'Lapsed or idle — no recent activity or enrollment.',
    color: '#E11D48',
  },
  {
    value: 'archived',
    label: 'Archived',
    phase: 'student',
    description: 'Closed / no longer managed in the active pipeline.',
    color: '#64748B',
  },
]

export const CUSTOMER_LIFECYCLE_STATUS_OPTIONS = CUSTOMER_LIFECYCLE_STATUS_META.map(
  ({ value, label }) => ({ value, label })
)

export function customerLifecycleLabel(status) {
  const key = String(status || '').toLowerCase()
  return (
    CUSTOMER_LIFECYCLE_STATUS_META.find((s) => s.value === key)?.label ||
    (key ? key.replace(/_/g, ' ') : 'Active')
  )
}

export function customerLifecycleColor(status) {
  const key = String(status || 'active').toLowerCase()
  const match = CUSTOMER_LIFECYCLE_STATUS_META.find((s) => s.value === key)
  const hex = sanitizeStatusHex(match?.color)
  if (hex) return hex
  return sanitizeStatusHex(
    CUSTOMER_LIFECYCLE_STATUS_META.find((s) => s.value === 'active')?.color
  )
}

export function customerLifecycleBadgeClass(status) {
  switch (String(status || '').toLowerCase()) {
    case 'inactive':
      return 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400'
    case 'archived':
      return 'bg-muted text-muted-foreground dark:bg-slate-800/60 dark:text-muted-foreground'
    case 'trial_scheduled':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400'
    case 'trial_unscheduled':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
    case 'trial_no_show':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
    case 'no_sale':
      return 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
    case 'active':
    default:
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
  }
}

export function getCustomerLifecycleBadgeProps(status) {
  const color = customerLifecycleColor(status)
  if (color) {
    return { className: 'status-color-badge', style: { '--status-color': color } }
  }
  return { className: customerLifecycleBadgeClass(status), style: undefined }
}
