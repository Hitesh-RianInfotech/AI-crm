'use client'

import { useEffect, useState } from 'react'
import { Loader2, Send, Star } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export default function PublishWorkflowDialog({
  open,
  onClose,
  onConfirm,
  busy = false,
  initialValues = {},
  allowMarkDefault = false,
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState('active')
  const [isFavorite, setIsFavorite] = useState(false)
  const [isDefault, setIsDefault] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(String(initialValues.name || '').trim() || '')
    setDescription(String(initialValues.description || ''))
    setStatus(initialValues.status === 'inactive' ? 'inactive' : 'active')
    setIsFavorite(Boolean(initialValues.isFavorite))
    setIsDefault(Boolean(initialValues.isDefault))
  }, [open, initialValues])

  const canSubmit = Boolean(String(name || '').trim()) && !busy

  const handleConfirm = () => {
    if (!canSubmit) return
    onConfirm?.({
      name: String(name).trim(),
      description: String(description || '').trim(),
      status,
      isFavorite: Boolean(isFavorite),
      isDefault: allowMarkDefault ? Boolean(isDefault) : false,
    })
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md">
      <DialogContent onClose={busy ? undefined : onClose} className="space-y-5">
        <DialogHeader>
          <DialogTitle>Publish workflow</DialogTitle>
          <DialogDescription>
            Confirm the details below before publishing. You can set status
            {allowMarkDefault ? ', mark as a default template,' : ''} and favorite.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[12px] font-semibold text-foreground" htmlFor="publish-wf-name">
              Name
            </label>
            <Input
              id="publish-wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Workflow name"
              disabled={busy}
              className="h-11"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label
              className="text-[12px] font-semibold text-foreground"
              htmlFor="publish-wf-description"
            >
              Description
            </label>
            <textarea
              id="publish-wf-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
              disabled={busy}
              rows={3}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px] text-foreground outline-none focus:border-[var(--studio-primary)] disabled:opacity-60"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] font-semibold text-foreground" htmlFor="publish-wf-status">
              Status
            </label>
            <select
              id="publish-wf-status"
              value={status}
              onChange={(e) => setStatus(e.target.value === 'inactive' ? 'inactive' : 'active')}
              disabled={busy}
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-[14px] text-foreground outline-none focus:border-[var(--studio-primary)] disabled:opacity-60"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <label
            htmlFor="publish-wf-favorite"
            className={cn(
              'flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/20 px-3 py-3',
              busy && 'cursor-not-allowed opacity-60'
            )}
          >
            <input
              id="publish-wf-favorite"
              type="checkbox"
              checked={isFavorite}
              onChange={(e) => setIsFavorite(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 rounded border-border"
            />
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Star
                className={cn(
                  'h-4 w-4 shrink-0',
                  isFavorite ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'
                )}
              />
              <span>
                <span className="block text-[13px] font-semibold text-foreground">
                  Mark as favorite
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Favorites show up first in your workflow list
                </span>
              </span>
            </span>
          </label>

          {allowMarkDefault ? (
            <label
              htmlFor="publish-wf-default"
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border border-violet-500/30 bg-violet-500/5 px-3 py-3',
                busy && 'cursor-not-allowed opacity-60'
              )}
            >
              <input
                id="publish-wf-default"
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                disabled={busy}
                className="h-4 w-4 rounded border-border"
              />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <Star
                  className={cn(
                    'h-4 w-4 shrink-0',
                    isDefault ? 'fill-violet-500 text-violet-600' : 'text-muted-foreground'
                  )}
                />
                <span>
                  <span className="block text-[13px] font-semibold text-foreground">
                    Mark as default template
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    Shared with every location in your organisation (not tied to one branch)
                  </span>
                </span>
              </span>
            </label>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!canSubmit}
            className="gap-1.5 bg-[var(--studio-primary)] text-white hover:brightness-95"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Publish
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
