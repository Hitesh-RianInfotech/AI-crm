'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { hasPermission } from '@/lib/permissions'
import api from '@/lib/api'
import LocationSelector from '@/components/shared/LocationSelector'
import { useStripeConnection } from './useStripeConnection'
import { resolveLocationID } from '@/app/settings/payments/clover/useCloverConnection'

export default function StripeReaderManager() {
  const [locationID, setLocationID] = useState(null)
  const resolved = resolveLocationID(locationID)
  const { status } = useStripeConnection(locationID)
  const [readers, setReaders] = useState([])
  const [loading, setLoading] = useState(false)
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState('')
  const toast = useToast()

  const canWrite = hasPermission('settings', 'payments', 'write')
  const canDelete = hasPermission('settings', 'payments', 'delete')
  const connected = status === 'connected'

  const load = useCallback(async () => {
    if (!resolved) { setReaders([]); return }
    setLoading(true)
    const res = await api.get(`/api/payments/stripe/readers?locationID=${encodeURIComponent(resolved)}`)
    setReaders(res.success && Array.isArray(res.data) ? res.data : [])
    setLoading(false)
  }, [resolved])

  useEffect(() => { load() }, [load])

  async function pair() {
    if (!code.trim()) { toast.error({ title: 'Enter the pairing code', message: 'Shown on the reader screen (Settings → Generate pairing code).' }); return }
    setBusy('pair')
    const res = await api.post('/api/payments/stripe/readers', { locationID: resolved, registrationCode: code.trim(), label: label.trim() || undefined })
    setBusy('')
    if (res.success) {
      toast.success({ title: 'Reader paired', message: 'The Stripe reader is ready for in-person payments.' })
      setCode(''); setLabel(''); load()
    } else {
      toast.error({ title: 'Pairing failed', message: res.error || 'Check the code and try again.' })
    }
  }

  async function unpair(reader) {
    setBusy(reader._id)
    const res = await api.delete(`/api/payments/stripe/readers/${reader._id}?locationID=${encodeURIComponent(resolved)}`)
    setBusy('')
    if (res.success) { toast.success({ title: 'Reader removed' }); load() }
    else toast.error({ title: 'Remove failed', message: res.error })
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-foreground">Stripe Terminal</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Register a Stripe smart reader (WisePOS E, Reader S700) so staff can take card-present payments. On the reader, open Settings → Generate pairing code.
        </p>
      </div>

      <div className="mt-4 max-w-sm">
        <label className="mb-1.5 block text-sm font-medium text-foreground">Location *</label>
        <LocationSelector value={locationID} onChange={setLocationID} multiple={false} showAllOption={false} placeholder="Select location to configure…" />
      </div>

      {!resolved && <p className="mt-4 text-sm text-muted-foreground">Select a location to manage its readers.</p>}
      {resolved && !connected && <p className="mt-4 text-sm text-muted-foreground">Connect Stripe for this location first.</p>}

      {resolved && connected && (
        <div className="mt-4 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-foreground">Paired readers</h4>
            {loading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : readers.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No readers registered yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {readers.map((r) => (
                  <li key={r._id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{r.label || r.readerId}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.deviceType || 'Stripe reader'}{r.serial ? ` · ${r.serial}` : ''}{r.status ? ` · ${r.status}` : ''}
                      </p>
                    </div>
                    <Badge variant="secondary">Registered</Badge>
                    <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" disabled={!canDelete || busy === r._id} onClick={() => unpair(r)}>
                      {busy === r._id ? 'Removing…' : 'Remove'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg border border-border p-3">
            <h4 className="text-sm font-medium text-foreground">Register a reader</h4>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Pairing code</label>
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="quick-brown-fox" className="w-[200px]" />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Label (optional)</label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Front desk" className="w-[160px]" />
              </div>
              <Button size="sm" disabled={!canWrite || busy === 'pair'} onClick={pair}>
                {busy === 'pair' ? 'Registering…' : 'Register'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}
