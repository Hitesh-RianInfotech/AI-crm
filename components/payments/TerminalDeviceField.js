'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useCloverDevices } from '@/app/settings/payments/clover/useCloverDevices'
import { resolveLocationID } from '@/app/settings/payments/clover/useCloverConnection'

/**
 * Device picker shown when `method === "terminal"`. Lists Clover devices; if the
 * location has none it falls back to registered Stripe Terminal readers. The
 * parent reads `deviceID` back out via `onDeviceChange` (a document id in both
 * cases — the backend resolves it and dispatches to the right processor).
 *
 * When a Stripe reader is chosen, an optional "let the customer add a tip on the
 * reader" control appears; the parent reads it via `onTipConfig({ promptTip,
 * tipTeacherID })` and forwards those to /api/payment.
 */
export default function TerminalDeviceField({
  method,
  locationID,
  deviceID,
  onDeviceChange,
  onTipConfig,
  className,
}) {
  const { devices, loading } = useCloverDevices(locationID)
  const resolved = resolveLocationID(locationID)
  const [stripeReaders, setStripeReaders] = useState(null)
  const [teachers, setTeachers] = useState([])
  const [promptTip, setPromptTip] = useState(false)
  const [tipTeacherID, setTipTeacherID] = useState('')

  const usingStripe = devices.length === 0 && Array.isArray(stripeReaders) && stripeReaders.length > 0

  useEffect(() => {
    if (method !== 'terminal' || !resolved || (devices && devices.length > 0)) { setStripeReaders(null); return }
    let cancelled = false
    api.get(`/api/payments/stripe/readers?locationID=${encodeURIComponent(resolved)}`).then((res) => {
      if (!cancelled) setStripeReaders(res.success && Array.isArray(res.data) ? res.data : [])
    })
    return () => { cancelled = true }
  }, [method, resolved, devices])

  useEffect(() => {
    if (!usingStripe || teachers.length) return
    api.get('/api/teacher?limit=200&status=active').then((res) => {
      if (res.success) setTeachers(Array.isArray(res.data) ? res.data : [])
    })
  }, [usingStripe, teachers.length])

  useEffect(() => {
    onTipConfig?.(promptTip && tipTeacherID ? { promptTip: true, tipTeacherID } : { promptTip: false })
  }, [promptTip, tipTeacherID, onTipConfig])

  if (method !== 'terminal') return null

  const note = className ?? 'text-[11px] text-muted-foreground'

  if (!resolved) return <p className={note}>No location on this customer — a terminal payment needs one.</p>
  if (loading) return <p className={note}>Loading terminals…</p>

  const options = devices.length > 0
    ? devices.map((d) => ({ id: d._id, label: d.name || d.deviceId }))
    : (stripeReaders || []).map((r) => ({ id: r._id, label: r.label || r.readerId }))

  if (options.length === 0) {
    return (
      <p className={note}>
        {stripeReaders === null ? 'Loading terminals…' : 'No terminals paired for this location. Pair one in Settings → Integrations.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={deviceID || ''}
        onChange={(e) => onDeviceChange(e.target.value)}
        className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-primary"
      >
        <option value="" disabled>Select terminal…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>

      {usingStripe && deviceID && (
        <div className="rounded-md border border-border p-2.5 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[12px] font-medium">
            <input type="checkbox" checked={promptTip} onChange={(e) => setPromptTip(e.target.checked)} />
            Let the customer add a tip on the reader
          </label>
          {promptTip && (
            <select
              value={tipTeacherID}
              onChange={(e) => setTipTeacherID(e.target.value)}
              className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-[12px] outline-none focus:border-primary"
            >
              <option value="">Tip goes to which teacher?</option>
              {teachers.map((t) => <option key={t._id} value={t._id}>{t.name || t.email}</option>)}
            </select>
          )}
          {promptTip && !tipTeacherID && (
            <p className="text-[10px] text-amber-600">Pick a teacher — the reader won&apos;t prompt for a tip until you do.</p>
          )}
        </div>
      )}
    </div>
  )
}
