'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * Shown when the server refuses a status change because the customer does not meet the
 * target status's entry requirements (HTTP 422, code STATUS_REQUIREMENTS_NOT_MET).
 *
 * These guards warn rather than forbid. Blocking outright would have real cost — the only
 * way to mark a mid-package customer Inactive would be to cancel their package, which
 * issues a refund nobody asked for. So the admin can proceed by explaining why, and the
 * reason is stored against the customer and shown in their status history.
 *
 * Automation never reaches this dialog; a misconfigured rule stays hard-blocked.
 *
 * The 10-character minimum mirrors the existing override in
 * CustomerMigrationImportDialog — a reason is written for a colleague reading the history
 * months later, not to dismiss a modal.
 */

export const MIN_REASON_LENGTH = 10

export default function ConfirmStatusOverrideDialog({
  open,
  onClose,
  onConfirm,
  statusLabel,
  violations = [],
  busy = false,
}) {
  const [reason, setReason] = useState('')

  // Clear between openings so a reason typed for one refusal can't be submitted against
  // a different one after the dialog is dismissed and reopened.
  useEffect(() => {
    if (open) setReason('')
  }, [open])

  const trimmed = reason.trim()
  const tooShort = trimmed.length < MIN_REASON_LENGTH
  const blockedTitle = tooShort
    ? `Type at least ${MIN_REASON_LENGTH} characters explaining why`
    : undefined

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md">
      <DialogContent onClose={busy ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle>
            {statusLabel ? `Set status to ${statusLabel} anyway?` : 'Change status anyway?'}
          </DialogTitle>
          <DialogDescription>
            This customer doesn&apos;t currently qualify for that status.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-3">
          {violations.map((v, i) => (
            <div key={v.key || i} className="rounded-lg bg-destructive/10 px-3 py-2">
              <p className="text-[13px] font-medium text-destructive">{v.message}</p>
              {v.remedy && (
                <p className="mt-1 text-[12px] text-muted-foreground">{v.remedy}</p>
              )}
            </div>
          ))}

          <div className="space-y-1.5">
            <label htmlFor="status-override-reason" className="text-[12px] font-medium text-foreground">
              Reason for the override
            </label>
            <textarea
              id="status-override-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground disabled:opacity-60"
              placeholder={`Why are you setting this status anyway? (min ${MIN_REASON_LENGTH} characters)`}
            />
            <p className="text-[11px] text-muted-foreground">
              Saved with your name against this customer, and shown in their status history.
            </p>
          </div>
        </div>

        <DialogFooter className="mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-[13px] font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={busy || tooShort}
            title={blockedTitle}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[var(--studio-primary)] px-4 text-[13px] font-medium text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Change anyway'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
