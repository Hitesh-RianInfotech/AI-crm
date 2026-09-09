'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { hasPermission } from '@/lib/permissions'
import LocationSelector from '@/components/shared/LocationSelector'
import { useStripeConnection } from './useStripeConnection'
import { useCloverConnection } from '@/app/settings/payments/clover/useCloverConnection'

export default function StripeConnectionCard({ locationID: fixedLocationID = null }) {
  const [ownLocationID, setOwnLocationID] = useState(null)
  const locationID = fixedLocationID ?? ownLocationID
  const {
    status, configured, accountName, accountId, chargesEnabled, detailsSubmitted,
    connectedAt, webhookLastReceivedAt, paymentProvider, lastError,
    connect, disconnect, setProvider,
  } = useStripeConnection(locationID)
  const clover = useCloverConnection(locationID)
  const [busy, setBusy] = useState('')
  const toast = useToast()

  const canWrite = hasPermission('settings', 'payments', 'write')
  const canDelete = hasPermission('settings', 'payments', 'delete')
  const bothConnected = status === 'connected' && clover.status === 'connected'
  const effectiveProvider = paymentProvider || (status === 'connected' && clover.status !== 'connected' ? 'stripe' : clover.status === 'connected' && status !== 'connected' ? 'clover' : 'clover')

  async function handleConnect() {
    if (!locationID) { toast.error({ title: 'Select a location', message: 'Choose which studio location to connect Stripe for.' }); return }
    setBusy('connect')
    const res = await connect()
    if (!res.success) { setBusy(''); toast.error({ title: 'Connect failed', message: res.error }) }
  }

  async function handleDisconnect() {
    setBusy('disconnect')
    const res = await disconnect()
    setBusy('')
    if (res.success) toast.success({ title: 'Stripe disconnected', message: 'This location is no longer connected to Stripe.' })
    else toast.error({ title: 'Disconnect failed', message: res.error })
  }

  async function chooseProvider(p) {
    setBusy('provider')
    const res = await setProvider(p)
    setBusy('')
    if (res.success) toast.success({ title: 'Payment processor updated', message: `Card payments will now use ${p === 'stripe' ? 'Stripe' : 'Clover'}.` })
    else toast.error({ title: 'Update failed', message: res.error })
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Stripe</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Accept card payments into this studio&apos;s own Stripe account. Runs alongside Clover — if both are connected, pick which one takes payments.
          </p>
        </div>
        {locationID && status === 'connected' && (
          <Badge className={chargesEnabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400'}>
            {chargesEnabled ? 'Connected' : 'Onboarding incomplete'}
          </Badge>
        )}
        {locationID && status === 'disconnected' && <Badge variant="secondary">Not Connected</Badge>}
      </div>

      {!configured && (
        <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
          Stripe is not configured on the server. Set STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID, STRIPE_CONNECT_CALLBACK_URL and STRIPE_WEBHOOK_SECRET.
        </p>
      )}

      {!fixedLocationID && (
        <div className="mt-4 max-w-sm">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Location *</label>
          <LocationSelector value={locationID} onChange={setOwnLocationID} multiple={false} showAllOption={false} placeholder="Select location to configure…" />
        </div>
      )}

      {!locationID && <p className="mt-4 text-sm text-muted-foreground">Select a location to view or manage its Stripe connection.</p>}

      {locationID && status === 'connected' && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-muted-foreground">Account</dt><dd className="font-medium text-foreground">{accountName || '—'}</dd></div>
            <div><dt className="text-muted-foreground">Account ID</dt><dd className="font-mono text-xs text-foreground">{accountId || '—'}</dd></div>
            <div><dt className="text-muted-foreground">Connected</dt><dd className="font-medium text-foreground">{connectedAt ? new Date(connectedAt).toLocaleDateString() : '—'}</dd></div>
            <div><dt className="text-muted-foreground">Last webhook</dt><dd className="font-medium text-foreground">{webhookLastReceivedAt ? new Date(webhookLastReceivedAt).toLocaleString() : 'none yet'}</dd></div>
          </dl>
          {!detailsSubmitted && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
              This Stripe account hasn&apos;t finished onboarding — payments will fail until it does.
            </p>
          )}
        </>
      )}

      {locationID && lastError && status !== 'connected' && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">{lastError}</p>
      )}

      {locationID && bothConnected && (
        <div className="mt-5 rounded-xl border border-border p-4">
          <p className="text-sm font-medium text-foreground">Active card processor for this location</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Both Clover and Stripe are connected. New card payments use:</p>
          <div className="mt-3 inline-flex rounded-lg border border-border bg-background p-0.5">
            {[{ v: 'clover', label: 'Clover' }, { v: 'stripe', label: 'Stripe' }].map((o) => (
              <button
                key={o.v}
                type="button"
                disabled={!canWrite || busy === 'provider'}
                onClick={() => chooseProvider(o.v)}
                className={['h-8 px-4 rounded-md text-[13px] font-medium transition-colors',
                  effectiveProvider === o.v ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground'].join(' ')}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {locationID && configured && (
        <div className="mt-5 flex gap-3">
          {status === 'disconnected' && (
            <Button onClick={handleConnect} disabled={!canWrite || busy === 'connect'}>
              {busy === 'connect' ? 'Connecting…' : 'Connect Stripe'}
            </Button>
          )}
          {status === 'connected' && (
            <>
              <Button onClick={handleConnect} disabled={!canWrite || busy === 'connect'}>
                {busy === 'connect' ? 'Connecting…' : 'Reconnect'}
              </Button>
              <Button variant="outline" onClick={handleDisconnect} disabled={!canDelete || busy === 'disconnect'}>
                {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  )
}
