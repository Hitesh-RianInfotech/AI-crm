'use client'

import { useRouter } from 'next/navigation'
import { Copy, Heart, Loader2, Pencil, Star, Trash2, Workflow } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import Switch from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  flattenWorkflowSteps,
  normalizeWorkflowListIdFromApi,
  normalizeWorkflowListNameFromApi,
} from '@/lib/workflow-normalize'
import { formatReasonLabel } from '@/lib/dynamic-list-normalize'

function formatDate(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return '—'
  }
}

function scopeBadge(variant) {
  if (variant === 'org_default') {
    return {
      label: 'Org Default',
      className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    }
  }
  if (variant === 'global') {
    return {
      label: 'Global',
      className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    }
  }
  return null
}

/**
 * @param {'own' | 'org_default' | 'global'} variant
 */
export default function WorkflowCard({
  workflow,
  variant = 'own',
  canManageDefaults = false,
  isSuperAdmin = false,
  onDelete,
  onDuplicate,
  onChangeScope,
  onSetActivation,
  onToggleStatus,
  onToggleFavorite,
  duplicating = false,
  busy = false,
  detailPathBase = '/ai-automation/workflows',
}) {
  const router = useRouter()
  const id = workflow?._id || workflow?.id
  const flatSteps = flattenWorkflowSteps(workflow?.steps)
  const stepsCount = flatSteps.length || workflow?.stepsCount || 0
  const listID = normalizeWorkflowListIdFromApi(workflow)
  const listName = normalizeWorkflowListNameFromApi(workflow) || workflow?.listName || ''
  const triggerLabel = listID
    ? listName || 'Dynamic list'
    : workflow?.audienceMode
      ? `Audience: ${workflow.audienceMode}`
      : workflow?.event || '—'
  const reasonLabel =
    listID || workflow?.event || workflow?.reason
      ? formatReasonLabel(workflow?.reason)
      : ''

  const isOwn = variant === 'own'
  const isOrgDefault = variant === 'org_default'
  const isGlobal = variant === 'global'
  const badge = scopeBadge(variant)

  const isActivated = workflow?.studioActivationStatus === 'active'
  // Org defaults + own use document status; global uses studioActivationStatus.
  const isInactive = isGlobal
    ? workflow?.studioActivationStatus !== 'active'
    : workflow?.status === 'inactive'

  const canEditTemplate = isOrgDefault
    ? canManageDefaults
    : isGlobal
      ? isSuperAdmin
      : true
  const canDeleteTemplate = canEditTemplate
  const showStatusSwitch = isOwn || (isOrgDefault && canManageDefaults) || isGlobal
  const disabled = duplicating || busy
  const openHref = `${detailPathBase}/builder?id=${id}`

  const handleSwitch = () => {
    if (isGlobal) {
      onSetActivation?.(id, isActivated ? 'inactive' : 'active')
      return
    }
    onToggleStatus?.(id, isInactive ? 'active' : 'inactive')
  }

  return (
    <Card
      className={cn(
        'relative transition-all duration-200 hover:shadow-lg',
        isInactive && 'opacity-60',
      )}
    >
      <div className="absolute right-3 top-3 flex items-center gap-1">
        {badge ? (
          <span
            className={cn(
              'mr-1 inline-flex h-6 items-center rounded-full px-2 text-[10px] font-semibold',
              badge.className,
            )}
          >
            {badge.label}
          </span>
        ) : null}
        {showStatusSwitch ? (
          <Switch
            checked={!isInactive}
            onChange={handleSwitch}
            disabled={disabled}
            title={isInactive ? 'Set active' : 'Set inactive'}
            className="scale-75 disabled:opacity-40"
          />
        ) : null}
        {isOwn ? (
          <button
            type="button"
            onClick={() => onToggleFavorite?.(id)}
            disabled={disabled}
            title={workflow?.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full transition-all duration-200 disabled:opacity-40',
              workflow?.isFavorite
                ? 'text-red-500 hover:bg-red-50'
                : 'text-muted-foreground hover:bg-muted hover:text-red-400',
            )}
          >
            <Heart className={cn('h-4 w-4', workflow?.isFavorite && 'fill-current')} />
          </button>
        ) : null}
      </div>

      <CardHeader className="pr-24">
        <div className="mb-2 flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <Workflow className="h-6 w-6 text-slate-600" />
          </div>
        </div>
        <CardTitle className="line-clamp-1 text-lg">{workflow?.name || '—'}</CardTitle>
        {workflow?.description ? (
          <p className="line-clamp-2 text-sm text-slate-500">{workflow.description}</p>
        ) : null}
      </CardHeader>

      <CardContent>
        <div className="mb-4 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Trigger</span>
            <span className="max-w-[160px] truncate font-medium text-slate-900">{triggerLabel}</span>
          </div>
          {reasonLabel ? (
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Reason</span>
              <span className="max-w-[160px] truncate font-medium text-slate-900">{reasonLabel}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Steps</span>
            <span className="font-medium text-slate-900">{stepsCount}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Created</span>
            <span className="font-medium text-slate-900">{formatDate(workflow?.createdAt)}</span>
          </div>
        </div>

        <div className="flex gap-2">
          {canEditTemplate ? (
            <Button
              variant="gradient"
              size="sm"
              className="flex-1"
              disabled={isOwn && isInactive}
              onClick={() => router.push(openHref)}
            >
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {isOwn ? 'Open' : 'Edit'}
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={disabled || (isOwn && isInactive)}
            onClick={() => onDuplicate?.(id)}
          >
            {duplicating ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Copy className="mr-1.5 h-3.5 w-3.5" />
            )}
            {duplicating ? 'Cloning…' : 'Clone'}
          </Button>
          {(isOwn || canDeleteTemplate) && onDelete ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => onDelete?.(id)}
              disabled={disabled}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>

        {canManageDefaults && isOwn ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            disabled={disabled}
            onClick={() => onChangeScope?.(id, null, 'promote')}
          >
            <Star className="mr-1.5 h-3.5 w-3.5" />
            Mark as default
          </Button>
        ) : null}

        {canManageDefaults && (isOrgDefault || (isGlobal && isSuperAdmin)) ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 w-full"
            disabled={disabled}
            onClick={() =>
              onChangeScope?.(
                id,
                isOrgDefault ? 'organization_default' : 'global',
                'change',
              )
            }
          >
            Change scope
          </Button>
        ) : null}

        {isOrgDefault && !canManageDefaults ? (
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Organisation template — clone to customize for your location.
          </p>
        ) : null}
        {isGlobal && !isSuperAdmin ? (
          <p className="mt-2 text-[11px] leading-snug text-slate-500">
            Global template — use the switch to opt your studio in or out. Clone to customize.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
