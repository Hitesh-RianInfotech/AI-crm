'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { hasPermission } from '@/lib/permissions'
import LocationSelector from '@/components/shared/LocationSelector'
import { useCloverConnection } from './useCloverConnection'
import CloverWebhookSetup from './CloverWebhookSetup'

export default function CloverConnectionCard({ locationID: fixedLocationID = null }) {
  const [ownLocationID, setOwnLocationID] = useState(null)
  const locationID = fixedLocationID ?? ownLocationID
  const {
    status,
    merchantId,
    merchantName,
    connectedAt,
    lastError,
    webhookUrl,
    webhookSecretSaved,
    webhookLastReceivedAt,
    webhookLastError,
    saveWebhookSecret,
    connect,
    disconnect,
  } = useCloverConnection(locationID)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const toast = useToast()

  const canWrite = hasPermission('settings', 'payments', 'write')
  const canDelete = hasPermission('settings', 'payments', 'delete')

  async function handleConnect() {
    if (!locationID) {
      toast.error({ title: 'Select a location', message: 'Choose which studio location to connect Clover for.' })
      return
    }
    setConnecting(true)
    const result = await connect()
    if (!result.success) {
      setConnecting(false)
      toast.error({ title: 'Connect failed', message: result.error || 'Unable to start the Clover connection.' })
    }
    // On success we're navigating away to Clover, so leave `connecting` true — no state update needed.
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    const result = await disconnect()
    setDisconnecting(false)
    if (result.success) {
      toast.success({ title: 'Clover disconnected', message: 'The location is no longer connected to Clover.' })
    } else {
      toast.error({ title: 'Disconnect failed', message: result.error || 'Unable to disconnect Clover.' })
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-foreground">Clover</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Accept payments into this location&apos;s Clover merchant account.
          </p>
        </div>
        {locationID && status === 'connected' && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">Connected</Badge>}
        {locationID && status === 'error' && <Badge className="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400">Reconnect required</Badge>}
        {locationID && status === 'disconnected' && <Badge variant="secondary">Not Connected</Badge>}
      </div>

      {!fixedLocationID && (
        <div className="mt-4 max-w-sm">
          <label className="mb-1.5 block text-sm font-medium text-foreground">Location *</label>
          <LocationSelector
            value={locationID}
            onChange={setOwnLocationID}
            multiple={false}
            showAllOption={false}
            placeholder="Select location to configure…"
          />
        </div>
      )}

      {!locationID && (
        <p className="mt-4 text-sm text-muted-foreground">
          Select a location to view or manage its Clover connection.
        </p>
      )}

      {locationID && status === 'connected' && (
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Merchant</dt>
            <dd className="font-medium text-foreground">{merchantName || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Merchant ID</dt>
            <dd className="font-medium text-foreground">{merchantId || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Connected</dt>
            <dd className="font-medium text-foreground">
              {connectedAt ? new Date(connectedAt).toLocaleDateString() : '—'}
            </dd>
          </div>
        </dl>
      )}

      {locationID && status === 'error' && lastError && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          {lastError}
        </p>
      )}

      {locationID && status === 'connected' && (
        <CloverWebhookSetup
          webhookUrl={webhookUrl}
          webhookSecretSaved={webhookSecretSaved}
          webhookLastReceivedAt={webhookLastReceivedAt}
          webhookLastError={webhookLastError}
          saveWebhookSecret={saveWebhookSecret}
          canWrite={canWrite}
        />
      )}

      {locationID && (
        <div className="mt-5 flex gap-3">
          {status === 'disconnected' && (
            <Button onClick={handleConnect} disabled={!canWrite || connecting} title={!canWrite ? 'You do not have permission to connect Clover' : undefined}>
              {connecting ? 'Connecting…' : 'Connect Clover'}
            </Button>
          )}
          {(status === 'connected' || status === 'error') && (
            <>
              <Button onClick={handleConnect} disabled={!canWrite || connecting} title={!canWrite ? 'You do not have permission to reconnect Clover' : undefined}>
                {connecting ? 'Connecting…' : 'Reconnect'}
              </Button>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={!canDelete || disconnecting}
                title={!canDelete ? 'You do not have permission to disconnect Clover' : undefined}
              >
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </>
          )}
        </div>
      )}
    </article>
  )
}
