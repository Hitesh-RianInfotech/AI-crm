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
 * A Clover charge blocks the request until it completes at the device. A Stripe
 * reader charge returns immediately with a pending Payment and is confirmed by
 * webhook once the customer taps their card.
 */
export default function TerminalDeviceField({ method, locationID, deviceID, onDeviceChange, className }) {
  const { devices, loading } = useCloverDevices(locationID)
  const resolved = resolveLocationID(locationID)
  const [stripeReaders, setStripeReaders] = useState(null)

  useEffect(() => {
    if (method !== 'terminal' || !resolved || (devices && devices.length > 0)) { setStripeReaders(null); return }
    let cancelled = false
    api.get(`/api/payments/stripe/readers?locationID=${encodeURIComponent(resolved)}`).then((res) => {
      if (!cancelled) setStripeReaders(res.success && Array.isArray(res.data) ? res.data : [])
    })
    return () => { cancelled = true }
  }, [method, resolved, devices])

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
  )
}
