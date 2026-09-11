'use client'

import { useEffect, useState } from 'react'
import {
  Calendar,
  Eye,
  Mail,
  MapPin,
  Phone,
  Sparkles,
  Tag,
} from 'lucide-react'
import api from '@/lib/api'
import { cn, getInitials } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  formatDateTime,
  formatFieldDisplayValue,
  formatReasonLabel,
} from '@/lib/dynamic-list-normalize'
import { formatLeadStageLabel, getLeadStageColor, useLeadStages } from '@/lib/lead-stages'
import StatusColorBadge from '@/components/shared/StatusColorBadge'

function avatarTone(name = '') {
  const palette = [
    'from-blue-500 to-cyan-500',
    'from-violet-500 to-fuchsia-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
    'from-rose-500 to-pink-500',
    'from-indigo-500 to-purple-500',
  ]
  return palette[(name.charCodeAt(0) || 0) % palette.length]
}

function InfoCard({ icon: Icon, label, value, tone = 'slate', className }) {
  const tones = {
    blue: 'border-blue-200/80 bg-gradient-to-br from-blue-50 to-sky-50 dark:from-blue-500/10 dark:to-sky-500/5 dark:border-blue-500/20',
    violet: 'border-violet-200/80 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-500/10 dark:to-fuchsia-500/5 dark:border-violet-500/20',
    emerald: 'border-emerald-200/80 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-500/10 dark:to-teal-500/5 dark:border-emerald-500/20',
    amber: 'border-amber-200/80 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-500/10 dark:to-orange-500/5 dark:border-amber-500/20',
    rose: 'border-rose-200/80 bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-500/10 dark:to-pink-500/5 dark:border-rose-500/20',
    slate: 'border-border bg-gradient-to-br from-muted/50 to-muted/20',
  }

  const iconTones = {
    blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
    violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-300',
    emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
    amber: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
    slate: 'bg-muted text-muted-foreground',
  }

  const display = value === null || value === undefined || String(value).trim() === '' ? '—' : value

  return (
    <div className={cn('rounded-2xl border p-4 shadow-sm', tones[tone] || tones.slate, className)}>
      <div className="flex items-start gap-3">
        {Icon && (
          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', iconTones[tone] || iconTones.slate)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-[15px] font-semibold text-foreground break-words">{display}</div>
        </div>
      </div>
    </div>
  )
}

function resolveLocationLabel(lead, locations = []) {
  if (lead?.location && !/^[a-f0-9]{24}$/i.test(String(lead.location))) {
    return lead.location
  }
  const id = lead?.locationID
  if (!id) return ''
  const ids = Array.isArray(id) ? id : [id]
  const names = ids
    .map((locationId) => locations.find((loc) => loc._id === locationId)?.name)
    .filter(Boolean)
  return names.join(', ')
}

export default function MemberLeadViewDialog({
  open,
  leadId,
  onClose,
  leadReasons = [],
  locations = [],
}) {
  const { stages: stageOptions } = useLeadStages()
  const [lead, setLead] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !leadId) {
      setLead(null)
      setError('')
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError('')
    setLead(null)

    api
      .get(`/api/lead/${leadId}`)
      .then((res) => {
        if (cancelled) return
        if (res?.success) {
          setLead(res?.data || null)
        } else {
          setError(res?.error || 'Failed to load lead details.')
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load lead details.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, leadId])

  const source = lead?.utm_source || lead?.source || ''
  const locationLabel = resolveLocationLabel(lead, locations)
  const leadName = lead?.name || 'Lead'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="2xl">
      <DialogContent className="max-h-[90vh] overflow-y-auto p-0" onClose={onClose}>
        <div className="border-b border-border bg-gradient-to-r from-[var(--studio-primary)]/10 via-violet-500/10 to-cyan-500/10 px-6 py-5">
          <DialogHeader className="space-y-0 text-left">
            <DialogTitle className="flex items-center gap-2 text-[20px]">
              <Eye className="h-5 w-5 text-[var(--studio-primary)]" />
              Lead details
            </DialogTitle>
          </DialogHeader>

          {lead && !loading && !error && (
            <div className="mt-4 flex items-center gap-4">
              <div
                className={cn(
                  'flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br text-lg font-bold text-white shadow-md',
                  avatarTone(leadName)
                )}
              >
                {getInitials(leadName)}
              </div>
              <div className="min-w-0">
                <div className="truncate text-[22px] font-bold text-foreground">{leadName}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {lead.stage && (
                    <StatusColorBadge
                      color={getLeadStageColor(lead.stage, stageOptions)}
                      className="border border-transparent px-2.5 py-1 text-[11px] font-semibold"
                    >
                      {formatLeadStageLabel(lead.stage, stageOptions)}
                    </StatusColorBadge>
                  )}
                  {lead.bookingStatus && (
                    <span
                      className={cn(
                        'inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                        lead.bookingStatus === 'Booked'
                          ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300'
                          : 'border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                      )}
                    >
                      {lead.bookingStatus}
                    </span>
                  )}
                  {lead.isEscalated && (
                    <span className="inline-flex rounded-full border border-rose-200 bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">
                      Escalated
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-5">
          {loading ? (
            <div className="py-10 text-center text-[14px] text-muted-foreground">Loading lead…</div>
          ) : error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
              {error}
            </div>
          ) : lead ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <InfoCard icon={Mail} label="Email" value={lead.email} tone="blue" />
              <InfoCard icon={Phone} label="Phone" value={lead.phoneNumber} tone="emerald" />
              <InfoCard
                icon={Sparkles}
                label="Upload type"
                value={lead.uploadType ? formatFieldDisplayValue(lead.uploadType) : ''}
                tone="violet"
              />
              <InfoCard icon={Tag} label="Reason" value={formatReasonLabel(lead.reason, leadReasons)} tone="amber" />
              {lead.actualReason && (
                <InfoCard icon={Tag} label="Their Words" value={`“${lead.actualReason}”`} tone="amber" className="md:col-span-2" />
              )}
              <InfoCard
                icon={Tag}
                label="Source"
                value={source ? formatFieldDisplayValue(source) : ''}
                tone="rose"
              />
              <InfoCard icon={MapPin} label="Location" value={locationLabel} tone="emerald" className="md:col-span-2" />
              <InfoCard icon={Calendar} label="Created" value={formatDateTime(lead.createdAt)} tone="blue" />
              <InfoCard icon={Calendar} label="Updated" value={formatDateTime(lead.updatedAt)} tone="violet" />
            </div>
          ) : (
            <div className="py-10 text-center text-[14px] text-muted-foreground">No lead data found.</div>
          )}
        </div>

        <DialogFooter className="border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-xl bg-[var(--studio-primary)] px-5 text-[14px] font-semibold text-white hover:brightness-95"
          >
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
