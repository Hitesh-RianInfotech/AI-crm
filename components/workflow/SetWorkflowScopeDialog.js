'use client'

import { useEffect, useState } from 'react'
import { Loader2, Globe2, Building2, Workflow } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isSuperAdmin } from '@/lib/permissions'

const SCOPE_OPTIONS = [
  {
    value: 'organization_default',
    label: 'Organisation default',
    description: 'Visible at every branch in your organisation. Managed with Default Workflows permission.',
    icon: Building2,
  },
  {
    value: 'global',
    label: 'Global template',
    description: 'Shared across all studios. Each studio opts in. Superadmin only.',
    icon: Globe2,
    superAdminOnly: true,
  },
  {
    value: null,
    label: 'Regular workflow',
    description: 'Scoped to the current branch. Reset from a default/global template.',
    icon: Workflow,
    resetOnly: true,
  },
]

/**
 * Choose workflowScope for an existing workflow (PATCH /api/workflow/:id/scope).
 * @param {'promote' | 'change'} mode — promote hides null unless already scoped
 */
export default function SetWorkflowScopeDialog({
  open,
  onClose,
  onConfirm,
  busy = false,
  workflowName = '',
  currentScope = null,
  mode = 'promote',
}) {
  const superAdmin = isSuperAdmin()
  const [scope, setScope] = useState(currentScope ?? 'organization_default')

  useEffect(() => {
    if (!open) return
    if (currentScope === 'global' || currentScope === 'organization_default') {
      setScope(currentScope)
    } else {
      setScope('organization_default')
    }
  }, [open, currentScope])

  const options = SCOPE_OPTIONS.filter((opt) => {
    if (opt.superAdminOnly && !superAdmin) return false
    if (opt.resetOnly && mode === 'promote' && !currentScope) return false
    return true
  })

  const canSubmit = !busy && scope !== undefined

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md">
      <DialogContent onClose={busy ? undefined : onClose} className="space-y-5">
        <DialogHeader>
          <DialogTitle>
            {mode === 'change' ? 'Change workflow scope' : 'Mark as default'}
          </DialogTitle>
          <DialogDescription>
            {workflowName
              ? `Choose how “${workflowName}” is shared.`
              : 'Choose how this workflow is shared.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {options.map((opt) => {
            const Icon = opt.icon
            const selected = scope === opt.value
            return (
              <button
                key={String(opt.value)}
                type="button"
                disabled={busy}
                onClick={() => setScope(opt.value)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                  selected
                    ? 'border-violet-500/40 bg-violet-500/5'
                    : 'border-border bg-background hover:bg-muted/40',
                  busy && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                    selected ? 'bg-violet-500/15 text-violet-700' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-foreground">{opt.label}</span>
                  <span className="block text-[11px] text-muted-foreground">{opt.description}</span>
                </span>
                <span
                  className={cn(
                    'mt-1 h-4 w-4 shrink-0 rounded-full border',
                    selected
                      ? 'border-[var(--studio-primary)] bg-[var(--studio-primary)]'
                      : 'border-border bg-background',
                  )}
                />
              </button>
            )
          })}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm?.(scope)}
            className="bg-[var(--studio-primary)] text-white hover:brightness-95"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save scope
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
