'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Building2 } from 'lucide-react'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import StatusSelector from '@/components/shared/StatusSelector'
import { Select } from '@/components/ui/select'
import Switch from '@/components/ui/switch'
import {
  DEFAULT_LOCATION_TIMEZONE,
  getTimezoneSelectOptions,
  formatTimezoneLabel,
} from '@/lib/timezones'

const TIMEZONE_OPTIONS = getTimezoneSelectOptions()

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

function snapHalfHour(n, fallback) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.round(v * 2) / 2
}

/** Decimal hours (8.5) → 12-hour parts. Close at 24 → 12:00 AM. */
function decimalToClock(hourValue, role) {
  let v = Number(hourValue)
  if (!Number.isFinite(v)) v = role === 'close' ? 20 : 9
  v = Math.round(v * 2) / 2
  if (role === 'close' && (v === 24 || v === 0)) {
    return { hour: 12, minute: 0, period: 'AM' }
  }
  v = role === 'open' ? Math.max(0, Math.min(23.5, v)) : Math.max(0.5, Math.min(24, v))
  const h24 = Math.floor(v)
  const minute = v % 1 >= 0.5 ? 30 : 0
  if (h24 === 0) return { hour: 12, minute, period: 'AM' }
  if (h24 === 12) return { hour: 12, minute, period: 'PM' }
  if (h24 > 12) return { hour: h24 - 12, minute, period: 'PM' }
  return { hour: h24, minute, period: 'AM' }
}

/** 12-hour parts → decimal hours. Close 12:00 AM → 24. */
function clockToDecimal({ hour, minute, period }, role) {
  const h12 = Number(hour)
  const m = Number(minute) >= 30 ? 30 : 0
  const h24 = period === 'PM' ? (h12 === 12 ? 12 : h12 + 12) : h12 === 12 ? 0 : h12
  const value = h24 + (m === 30 ? 0.5 : 0)
  if (role === 'close' && value === 0) return 24
  if (role === 'open') return Math.min(23.5, value)
  return Math.min(24, Math.max(0.5, value))
}

const clockSelectClass =
  'h-8 min-w-0 cursor-pointer appearance-none rounded border-0 bg-transparent px-0 py-0 text-center text-[13px] font-medium leading-none tabular-nums text-foreground outline-none hover:bg-muted/70 focus:bg-muted/70 focus:ring-0 [text-align-last:center]'

function ClockField({ value, role, dayLabel, which, onChange }) {
  const parts = decimalToClock(value, role)
  const commit = (patch) => onChange(clockToDecimal({ ...parts, ...patch }, role))

  return (
    <div className="inline-flex items-center">
      <select
        value={parts.hour}
        onChange={(e) => commit({ hour: Number(e.target.value) })}
        aria-label={`${dayLabel} ${which} hour`}
        className={`${clockSelectClass} w-6`}
      >
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span className="w-2 shrink-0 text-center text-[13px] font-medium text-muted-foreground" aria-hidden>
        :
      </span>
      <select
        value={parts.minute}
        onChange={(e) => commit({ minute: Number(e.target.value) })}
        aria-label={`${dayLabel} ${which} minutes`}
        className={`${clockSelectClass} w-7`}
      >
        <option value={0}>00</option>
        <option value={30}>30</option>
      </select>
      <select
        value={parts.period}
        onChange={(e) => commit({ period: e.target.value })}
        aria-label={`${dayLabel} ${which} AM or PM`}
        className={`${clockSelectClass} w-8`}
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}

function HoursRange({ open, close, dayLabel, onOpenChange, onCloseChange }) {
  return (
    <div className="inline-flex h-9 shrink-0 items-center rounded-lg border border-input bg-background px-1.5 focus-within:border-[var(--studio-primary)] focus-within:ring-2 focus-within:ring-[var(--studio-primary)]/15">
      <ClockField value={open} role="open" dayLabel={dayLabel} which="opens" onChange={onOpenChange} />
      <span className="px-1.5 text-[11px] text-muted-foreground select-none">to</span>
      <ClockField value={close} role="close" dayLabel={dayLabel} which="closes" onChange={onCloseChange} />
    </div>
  )
}

const DEFAULT_OPERATING_HOURS = [
  { day: 0, closed: true,  open: 9,  close: 20 },
  { day: 1, closed: false, open: 9,  close: 20 },
  { day: 2, closed: false, open: 9,  close: 20 },
  { day: 3, closed: false, open: 9,  close: 20 },
  { day: 4, closed: false, open: 9,  close: 20 },
  { day: 5, closed: false, open: 9,  close: 20 },
  { day: 6, closed: false, open: 9,  close: 17 },
]

function patchDayHours(hours, day, updater) {
  return (hours || DEFAULT_OPERATING_HOURS).map((d) => (d.day === day ? updater(d) : d))
}

/** Ensure we always have one entry per weekday (0–6) for the editor. */
function normalizeOperatingHours(hours) {
  const byDay = new Map(
    (Array.isArray(hours) ? hours : []).map((h) => [Number(h.day), h]),
  )
  return DEFAULT_OPERATING_HOURS.map((def) => {
    const h = byDay.get(def.day)
    if (!h) return { ...def }
    return {
      day: def.day,
      closed: Boolean(h.closed),
      open: snapHalfHour(h.open, def.open),
      close: snapHalfHour(h.close, def.close),
    }
  })
}

function phoneStatusBadge(status) {
  if (status === 'connected') return <Badge variant="success">Calling connected</Badge>
  if (status === 'error') return <Badge variant="error">Calling error</Badge>
  return <Badge variant="secondary">Calling not connected</Badge>
}

const emptyLocation = () => ({
  name: '',
  address: '',
  city: '',
  state: '',
  country: '',
  zip: '',
  phoneNumber: '',
  footerPhone: '',
  email: '',
  website: '',
  socialMedia: '',
  status: 'active',
  timezone: DEFAULT_LOCATION_TIMEZONE,
  emailConversationEnabled: false,
  defaultLessonMinutes: 60,
  operatingHours: [...DEFAULT_OPERATING_HOURS],
})

export default function LocationsDialog({ open, onClose, locations = [], onRefresh, initialLocationId = null }) {
  const [editingLocation, setEditingLocation] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('create')
  const toast = useToast()

  useEffect(() => {
    if (!open) {
      setEditingLocation(null)
      setMode('create')
      return
    }
    if (initialLocationId && locations && locations.length > 0) {
      const found = locations.find((l) => l._id === initialLocationId)
      if (found) {
        setEditingLocation({
          ...found,
          timezone: found.timezone || DEFAULT_LOCATION_TIMEZONE,
          defaultLessonMinutes: found.defaultLessonMinutes ?? 60,
          operatingHours: normalizeOperatingHours(found.operatingHours),
        })
        setMode('edit')
      }
    } else {
      setEditingLocation(emptyLocation())
      setMode('create')
    }
  }, [open, initialLocationId, locations])

  function openCreate() {
    setEditingLocation(emptyLocation())
    setMode('create')
  }

  function closeEdit() {
    setEditingLocation(null)
    setMode('create')
  }

  async function saveLocation() {
    if (!editingLocation) return

    if (!editingLocation.name || !editingLocation.address || !editingLocation.email) {
      toast.error({ title: 'Validation Error', message: 'Name, address, and email are required' })
      return
    }

    if (!editingLocation.timezone) {
      toast.error({ title: 'Validation Error', message: 'Please select a timezone' })
      return
    }

    setLoading(true)
    try {
      const payload = {
        name: editingLocation.name,
        address: editingLocation.address,
        city: editingLocation.city || null,
        state: editingLocation.state || null,
        country: editingLocation.country || null,
        zip: editingLocation.zip || null,
        phoneNumber: editingLocation.phoneNumber || null,
        footerPhone: editingLocation.footerPhone || null,
        email: editingLocation.email,
        website: editingLocation.website || null,
        socialMedia: editingLocation.socialMedia || null,
        status: editingLocation.status || 'active',
        timezone: editingLocation.timezone || DEFAULT_LOCATION_TIMEZONE,
        emailConversationEnabled: Boolean(editingLocation.emailConversationEnabled),
        defaultLessonMinutes: Number(editingLocation.defaultLessonMinutes) || 60,
        operatingHours: normalizeOperatingHours(editingLocation.operatingHours),
      }

      const result = editingLocation._id
        ? await api.put(`/api/location/${editingLocation._id}`, payload)
        : await api.post('/api/location', payload)

      if (result.success) {
        const saved = result.data
        const phoneOk = !saved?.phoneNumber || saved?.phoneStatus === 'connected'
        if (phoneOk) {
          toast.success({
            title: editingLocation._id ? 'Saved' : 'Created',
            message: editingLocation._id ? 'Location updated' : 'Location created',
          })
        } else {
          toast.error({
            title: 'Location saved — phone not connected',
            message:
              saved?.phoneLastError ||
              result.message ||
              'Check the number is on your Twilio account (E.164, e.g. +15551234567).',
          })
        }
        closeEdit()
        onRefresh && onRefresh()
        onClose?.()
      } else {
        toast.error({
          title: editingLocation._id ? 'Save failed' : 'Create failed',
          message: result.error || 'Unable to save location',
        })
      }
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Unexpected error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="2xl">
      <DialogContent onClose={onClose} className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-2xl">{mode === 'create' ? 'Create New Location' : 'Edit Location'}</DialogTitle>
              <DialogDescription className="mt-1">
                {mode === 'create'
                  ? 'Add a new branch or location to your organization'
                  : 'Update location information'}
              </DialogDescription>
            </div>
            {mode === 'edit' && (
              <Button variant="ghost" size="sm" onClick={openCreate} className="gap-2">
                <Building2 className="h-4 w-4" />
                New Location
              </Button>
            )}
          </div>
        </DialogHeader>

        {editingLocation && (
          <div className="space-y-6 mt-6">
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Basic Information</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Location Name *</label>
                  <Input
                    value={editingLocation.name || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Dance With Me Midtown"
                    required
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used as the email From display name and the first line of the footer.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Email *</label>
                  <Input
                    value={editingLocation.email || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, email: e.target.value }))}
                    placeholder="studio@yourdomain.com"
                    type="email"
                    required
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used as the outbound From address for this studio (must be allowed on your SendGrid domain).
                  </p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Street Address *</label>
                <Input
                  value={editingLocation.address || ''}
                  onChange={(e) => setEditingLocation((p) => ({ ...p, address: e.target.value }))}
                  placeholder="123 Main Street"
                  required
                />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Address Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">City</label>
                  <Input
                    value={editingLocation.city || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, city: e.target.value }))}
                    placeholder="City"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">State</label>
                  <Input
                    value={editingLocation.state || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, state: e.target.value }))}
                    placeholder="State"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Zip / Postal code</label>
                  <Input
                    value={editingLocation.zip || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, zip: e.target.value }))}
                    placeholder="10018"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Country</label>
                  <Input
                    value={editingLocation.country || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, country: e.target.value }))}
                    placeholder="Country"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Timezone *</label>
                <Select
                  value={editingLocation.timezone || DEFAULT_LOCATION_TIMEZONE}
                  onChange={(e) =>
                    setEditingLocation((p) => ({ ...p, timezone: e.target.value }))
                  }
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label} ({tz.description})
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Used for scheduling, follow-ups, and local business hours for this studio.
                  {editingLocation.timezone
                    ? ` Selected: ${formatTimezoneLabel(editingLocation.timezone)}`
                    : ''}
                </p>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                Email footer
              </h3>
              <p className="text-xs text-muted-foreground">
                Shown at the bottom of outbound emails for this studio. Blank fields are omitted
                automatically.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Phone (email footer)
                  </label>
                  <Input
                    value={editingLocation.footerPhone || ''}
                    onChange={(e) =>
                      setEditingLocation((p) => ({ ...p, footerPhone: e.target.value }))
                    }
                    placeholder="212-837-8111"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Public number shown as P: in emails. Leave blank to use the Twilio studio
                    number.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Website</label>
                  <Input
                    value={editingLocation.website || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, website: e.target.value }))}
                    placeholder="DanceWithMeUSA.com"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    Social media handle
                  </label>
                  <Input
                    value={editingLocation.socialMedia || ''}
                    onChange={(e) =>
                      setEditingLocation((p) => ({ ...p, socialMedia: e.target.value }))
                    }
                    placeholder="@DanceWithMeUSA"
                  />
                </div>
              </div>
              {(editingLocation.name ||
                editingLocation.footerPhone ||
                editingLocation.phoneNumber ||
                editingLocation.address ||
                editingLocation.website ||
                editingLocation.socialMedia) && (
                <div className="rounded-lg border border-border bg-muted/30 px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                    Preview
                  </p>
                  <div className="whitespace-pre-wrap font-mono text-[12px] text-foreground">
                    {[
                      editingLocation.name || null,
                      (editingLocation.footerPhone || editingLocation.phoneNumber)
                        ? `P: ${editingLocation.footerPhone || editingLocation.phoneNumber}`
                        : null,
                      editingLocation.address ? `A: ${editingLocation.address}` : null,
                      [editingLocation.city, [editingLocation.state, editingLocation.zip].filter(Boolean).join(' ')]
                        .filter(Boolean)
                        .join(', ') || null,
                      editingLocation.website ? `W: ${editingLocation.website}` : null,
                      editingLocation.socialMedia
                        ? `Social Media: ${editingLocation.socialMedia}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join('\n')}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <div>
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Booking Settings</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Controls when the AI may book lessons and prefer callback times. It does not silence the AI —
                  inbound SMS/calls still get a normal conversation on closed days; the agent just won't book
                  lessons for inactive days.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Default Lesson Length (minutes)</label>
                <input
                  type="number"
                  min={15}
                  max={180}
                  step={5}
                  value={editingLocation.defaultLessonMinutes ?? 60}
                  onChange={(e) =>
                    setEditingLocation((p) => ({ ...p, defaultLessonMinutes: Number(e.target.value) }))
                  }
                  className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Each booked slot and payment hold will use this duration (15–180 min).
                </p>
              </div>

              <div>
                <div className="mb-3">
                  <p className="text-sm font-medium text-foreground">Operating hours</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">
                    Studio local time. Closed days are not bookable; the agent still replies.
                  </p>
                </div>

                <div className="overflow-visible rounded-xl border border-border divide-y divide-border">
                  {DAY_ORDER.map((day) => {
                    const h = (editingLocation.operatingHours || DEFAULT_OPERATING_HOURS).find(
                      (d) => d.day === day,
                    ) || DEFAULT_OPERATING_HOURS[day]
                    const dayLabel = DAY_LABELS[day]
                    return (
                      <div
                        key={day}
                        className={[
                          'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 first:rounded-t-xl last:rounded-b-xl',
                          h.closed ? 'bg-muted/25' : 'bg-card',
                        ].join(' ')}
                      >
                        <span className="w-[4.75rem] shrink-0 text-[13px] font-medium text-foreground">
                          {dayLabel}
                        </span>

                        <div className="min-h-9 flex-1 flex items-center overflow-visible">
                          {h.closed ? (
                            <span className="text-[13px] text-muted-foreground">Closed</span>
                          ) : (
                            <HoursRange
                              open={h.open ?? 9}
                              close={h.close ?? 20}
                              dayLabel={dayLabel}
                              onOpenChange={(open) =>
                                setEditingLocation((p) => ({
                                  ...p,
                                  operatingHours: patchDayHours(p.operatingHours, day, (d) => ({
                                    ...d,
                                    open,
                                    close: Number(d.close) <= open
                                      ? Math.min(24, open + 0.5)
                                      : d.close,
                                  })),
                                }))
                              }
                              onCloseChange={(close) =>
                                setEditingLocation((p) => ({
                                  ...p,
                                  operatingHours: patchDayHours(p.operatingHours, day, (d) => ({
                                    ...d,
                                    close: Number(close) <= Number(d.open ?? 9)
                                      ? Math.min(24, Number(d.open ?? 9) + 0.5)
                                      : close,
                                  })),
                                }))
                              }
                            />
                          )}
                        </div>

                        <Switch
                          checked={!h.closed}
                          aria-label={`${dayLabel} ${h.closed ? 'closed' : 'open'}`}
                          onChange={(isOpen) =>
                            setEditingLocation((p) => ({
                              ...p,
                              operatingHours: patchDayHours(p.operatingHours, day, (d) => ({
                                ...d,
                                closed: !isOpen,
                              })),
                            }))
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">AI Agent Settings</h3>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Email Conversations</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When off (recommended), email is used for outbound workflows, payment links, and
                    confirmations only — inbound emails are logged but the AI does not reply.
                    Turn on to enable full back-and-forth email conversation.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(editingLocation.emailConversationEnabled)}
                  onClick={() =>
                    setEditingLocation((p) => ({
                      ...p,
                      emailConversationEnabled: !p.emailConversationEnabled,
                    }))
                  }
                  className={[
                    'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
                    editingLocation.emailConversationEnabled
                      ? 'bg-brand'
                      : 'bg-muted',
                  ].join(' ')}
                >
                  <span
                    className={[
                      'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform',
                      editingLocation.emailConversationEnabled ? 'translate-x-5' : 'translate-x-0',
                    ].join(' ')}
                  />
                </button>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                  Phone &amp; Status
                </h3>
                {mode === 'edit' && phoneStatusBadge(editingLocation.phoneStatus)}
              </div>
              <p className="text-xs text-muted-foreground">
                Studio phone number for AI calls, SMS, and inbound routing. Use E.164 (e.g. +15551234567).
                The number must already exist on your Twilio account — saving connects webhooks automatically.
                Clear the field to disconnect calling for this studio.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number</label>
                  <Input
                    value={editingLocation.phoneNumber || ''}
                    onChange={(e) => setEditingLocation((p) => ({ ...p, phoneNumber: e.target.value }))}
                    placeholder="+15551234567"
                  />
                  {editingLocation.phoneStatus === 'error' && editingLocation.phoneLastError && (
                    <p className="mt-1.5 text-xs text-destructive">{editingLocation.phoneLastError}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Status</label>
                  <StatusSelector
                    value={editingLocation.status || 'active'}
                    onChange={(status) => setEditingLocation((p) => ({ ...p, status }))}
                    placeholder="Select status"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <Button variant="ghost" onClick={closeEdit} disabled={loading}>
                Cancel
              </Button>
              <Button onClick={saveLocation} variant="gradient" disabled={loading}>
                {loading ? 'Saving...' : mode === 'create' ? 'Create Location' : 'Save Changes'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
