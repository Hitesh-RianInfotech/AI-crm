'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const DEFAULT_COLORS = [
  '#6B7280', '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
  '#8B5CF6', '#EC4899', '#F97316', '#14B8A6', '#059669',
]

/** White on light amber/grey washes out; pick ink vs white from luminance. */
function contrastTextOnHex(hex) {
  const raw = String(hex || '').replace('#', '')
  if (raw.length !== 6) return '#ffffff'
  const r = parseInt(raw.slice(0, 2), 16)
  const g = parseInt(raw.slice(2, 4), 16)
  const b = parseInt(raw.slice(4, 6), 16)
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return '#ffffff'
  return (r * 299 + g * 587 + b * 114) / 1000 >= 150 ? '#1A1220' : '#ffffff'
}

const inputClass =
  'w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-[var(--studio-primary)] focus:ring-2 focus:ring-[var(--studio-primary)]/15 disabled:opacity-60'

function createEmptyForm() {
  return {
    name: '',
    description: '',
    color: '#3B82F6',
    isActive: true,
  }
}

function formFromStatus(status) {
  if (!status) return createEmptyForm()
  return {
    name: status.name || '',
    description: status.description || '',
    color: status.color || '#3B82F6',
    isActive: status.isActive !== false,
  }
}

export default function LeadStatusFormDialog({ open, onClose, status, onSaved }) {
  const isEdit = Boolean(status?._id || status?.id)
  const [form, setForm] = useState(createEmptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError('')
    setForm(formFromStatus(status))
  }, [open, status])

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Stage name is required')
      return
    }
    setSaving(true)
    setError('')

    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      color: form.color,
      isActive: form.isActive,
    }

    const id = status?._id || status?.id
    const res = isEdit
      ? await api.patch(`/api/lead-status/${id}`, payload)
      : await api.post('/api/lead-status', payload)

    if (res?.success) {
      onSaved?.({ isEdit, status: res.data })
      onClose()
    } else {
      setError(res?.error || 'Failed to save lead stage')
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md">
      <DialogContent onClose={saving ? undefined : onClose} className="max-h-[90vh] overflow-y-auto p-0">
        <div className="sticky top-0 z-10 border-b border-border bg-card px-6 pb-4 pt-6">
          <DialogHeader>
            <DialogTitle className="text-[22px]">
              {isEdit ? 'Edit stage' : 'New lead stage'}
            </DialogTitle>
            <DialogDescription className="text-[14px]">
              Stages are labels only. Use Automations to decide when leads move between them.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-5">
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <label className="block text-[13px] font-semibold text-foreground">
                Name <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Booked"
                disabled={saving}
                autoFocus={!isEdit}
                className={inputClass}
              />
            </div>

            <div className="flex items-center gap-3 pb-0.5">
              <span
                className="inline-flex max-w-[140px] truncate rounded-full px-3 py-1.5 text-[12px] font-semibold shadow-sm"
                style={{ background: form.color, color: contrastTextOnHex(form.color) }}
              >
                {form.name.trim() || 'Preview'}
              </span>
              <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <span
                  className={cn(
                    'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    form.isActive ? 'bg-emerald-500' : 'bg-muted'
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={form.isActive}
                    disabled={saving}
                    onChange={(e) => set('isActive', e.target.checked)}
                  />
                  <span
                    className={cn(
                      'inline-block h-5 w-5 transform rounded-full bg-white shadow transition',
                      form.isActive ? 'translate-x-5' : 'translate-x-0'
                    )}
                  />
                </span>
                Active
              </label>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-[13px] font-semibold text-foreground">
              Short description
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Optional note for your team"
              disabled={saving}
              className={inputClass}
            />
          </div>

          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-foreground">Color</label>
            <div className="flex flex-wrap items-center gap-2">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => set('color', c)}
                  disabled={saving}
                  className={cn(
                    'h-8 w-8 rounded-full transition ring-offset-2 ring-offset-card',
                    form.color === c ? 'ring-2 ring-[var(--studio-primary)]' : 'hover:scale-110'
                  )}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
              <label className="relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border border-border">
                <input
                  type="color"
                  value={form.color}
                  onChange={(e) => set('color', e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                  disabled={saving}
                />
                <span
                  className="block h-full w-full"
                  style={{
                    background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)',
                  }}
                />
              </label>
            </div>
          </div>

          <DialogFooter className="gap-2 border-t border-border pt-4 sm:gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-background px-5 text-[14px] font-medium text-foreground hover:bg-muted/40 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-[var(--studio-primary)] px-6 text-[14px] font-semibold text-white hover:brightness-95 disabled:opacity-60"
            >
              {saving
                ? isEdit
                  ? 'Saving…'
                  : 'Creating…'
                : isEdit
                  ? 'Save stage'
                  : 'Create stage'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
