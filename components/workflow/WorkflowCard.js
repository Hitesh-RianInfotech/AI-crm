'use client'

import Link from 'next/link'
import { Copy, Loader2, Pencil, Trash2, Workflow, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  flattenWorkflowSteps,
  normalizeWorkflowListIdFromApi,
  normalizeWorkflowListNameFromApi,
} from '@/lib/workflow-normalize'
import { formatReasonLabel } from '@/lib/dynamic-list-normalize'

function activationLabel(studioActivationStatus) {
  if (studioActivationStatus === 'active') {
    return {
      label: 'Active',
      className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    }
  }
  return {
    label: 'Inactive',
    className: 'bg-muted text-muted-foreground',
  }
}

export default function WorkflowCard({
  workflow,
  variant = 'own', // 'own' | 'default'
  isSuperAdmin = false,
  canEditDefault = false,
  onDelete,
  onDuplicate,
  onToggleDefault,
  onSetActivation,
  duplicating = false,
  busy = false,
  detailPathBase = '/ai-automation/workflows',
}) {
  const id = workflow?._id || workflow?.id
  const flatSteps = flattenWorkflowSteps(workflow?.steps)
  const stepsCount = flatSteps.length || workflow?.stepsCount || 0
  const listID = normalizeWorkflowListIdFromApi(workflow)
  const listName = normalizeWorkflowListNameFromApi(workflow) || workflow?.listName || ''
  const triggerLabel = listID
    ? `List: ${listName || 'Dynamic list'} · ${formatReasonLabel(workflow?.reason)}`
    : workflow?.audienceMode
      ? `Audience: ${workflow.audienceMode}`
      : `Event: ${workflow?.event || '—'}`

  const isDefaultVariant = variant === 'default'
  const isOwnDefault = Boolean(workflow?.isDefault) && variant === 'own'
  const activation = activationLabel(workflow?.studioActivationStatus)
  const isActivated = workflow?.studioActivationStatus === 'active'
  const disabled = duplicating || busy

  return (
    <article className="h-auto min-h-[220px] w-full rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
            <Workflow className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {isOwnDefault || isDefaultVariant ? (
              <span className="inline-flex h-6 items-center rounded-md bg-violet-500/10 px-2.5 text-[10px] font-medium text-violet-700 dark:text-violet-300">
                Default
              </span>
            ) : null}
            {isDefaultVariant ? (
              <span
                className={cn(
                  'inline-flex h-6 items-center rounded-md px-2.5 text-[10px] font-medium',
                  activation.className,
                )}
              >
                {activation.label}
              </span>
            ) : (
              <span className="inline-flex h-6 items-center rounded-bl-md rounded-tr-md bg-primary/10 px-2.5 text-[10px] font-medium text-primary">
                {workflow?.status === 'inactive' ? 'Inactive' : 'Active'}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3">
          <h3 className="truncate text-[18px] font-semibold leading-7 text-foreground">
            {workflow?.name || '—'}
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {triggerLabel} • {stepsCount} steps
          </p>
          {workflow?.description ? (
            <p className="mt-2 line-clamp-2 text-[12px] text-muted-foreground">{workflow.description}</p>
          ) : null}
        </div>

        <div className="mt-auto space-y-2 pt-4">
          {isDefaultVariant ? (
            <>
              <div
                className={cn(
                  'grid gap-2',
                  canEditDefault ? 'grid-cols-3' : 'grid-cols-2',
                )}
              >
                {canEditDefault ? (
                  <Link
                    href={`${detailPathBase}/builder?id=${id}`}
                    className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-border bg-background text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
                  >
                    <Pencil className="h-3.5 w-3.5 shrink-0" />
                    Edit
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={() => onDuplicate?.(id)}
                  disabled={disabled}
                  className={cn(
                    'inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-border bg-background text-[11px] font-medium text-foreground hover:bg-muted/50',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {duplicating ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {duplicating ? 'Copying…' : 'Duplicate'}
                </button>
                <button
                  type="button"
                  onClick={() => onSetActivation?.(id, isActivated ? 'inactive' : 'active')}
                  disabled={disabled}
                  className={cn(
                    'inline-flex h-9 items-center justify-center gap-1 rounded-xl text-[11px] font-medium',
                    isActivated
                      ? 'border border-border bg-background text-foreground hover:bg-muted/50'
                      : 'bg-[var(--studio-primary)] text-white hover:brightness-95',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : null}
                  {isActivated ? 'Inactive' : 'Active'}
                </button>
              </div>
              {!canEditDefault ? (
                <p className="text-[10px] leading-snug text-muted-foreground">
                  Duplicate to customize for your studio. Only Active / Inactive can be changed here.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Link
                  href={`${detailPathBase}/builder?id=${id}`}
                  className="inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-border bg-background text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
                >
                  <Pencil className="h-3.5 w-3.5 shrink-0" />
                  Open
                </Link>
                <button
                  type="button"
                  onClick={() => onDuplicate?.(id)}
                  disabled={disabled}
                  className={cn(
                    'inline-flex h-9 items-center justify-center gap-1 rounded-xl border border-border bg-background text-[11px] font-medium text-foreground hover:bg-muted/50',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {duplicating ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {duplicating ? 'Copying…' : 'Duplicate'}
                </button>
                <button
                  type="button"
                  onClick={() => onDelete?.(id)}
                  disabled={disabled}
                  className={cn(
                    'inline-flex h-9 items-center justify-center gap-1 rounded-xl bg-[#EF4444] text-[11px] font-medium text-white hover:bg-[#DC2626]',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5 shrink-0" />
                  Delete
                </button>
              </div>
              {isSuperAdmin ? (
                <button
                  type="button"
                  onClick={() => onToggleDefault?.(id)}
                  disabled={disabled}
                  className={cn(
                    'inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-background text-[11px] font-medium hover:bg-muted/50',
                    isOwnDefault
                      ? 'text-violet-700 dark:text-violet-300'
                      : 'text-foreground',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Star
                      className={cn('h-3.5 w-3.5 shrink-0', isOwnDefault && 'fill-current')}
                    />
                  )}
                  {isOwnDefault ? 'Remove default' : 'Mark as default'}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </article>
  )
}
