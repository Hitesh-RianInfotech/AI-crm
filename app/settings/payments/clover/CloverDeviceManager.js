'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { hasPermission } from '@/lib/permissions'
import LocationSelector from '@/components/shared/LocationSelector'
import { useCloverConnection } from './useCloverConnection'
import { useCloverDevices, listAvailableDevices, pairDevice, unpairDevice } from './useCloverDevices'

/**
 * Pairing UI for physical Clover terminals ("Pay with Terminal"). Separate location
 * picker from CloverConnectionCard above it — mirrors that component's pattern
 * rather than sharing state, so this card works standalone if it's ever moved.
 */
export default function CloverDeviceManager({ locationID: fixedLocationID = null }) {
  const [ownLocationID, setOwnLocationID] = useState(null)
  const locationID = fixedLocationID ?? ownLocationID
  const { status: connectionStatus } = useCloverConnection(locationID)
  const { devices, loading, refresh } = useCloverDevices(locationID)
  const [available, setAvailable] = useState(null) // null = not fetched yet
  const [fetchingAvailable, setFetchingAvailable] = useState(false)
  const [pairingId, setPairingId] = useState(null)
  const [unpairingId, setUnpairingId] = useState(null)
  const toast = useToast()

  const canWrite = hasPermission('settings', 'payments', 'write')
  const canDelete = hasPermission('settings', 'payments', 'delete')
  const connected = connectionStatus === 'connected'

  const loadAvailable = useCallback(async () => {
    if (!locationID) return
    setFetchingAvailable(true)
    const result = await listAvailableDevices(locationID)
    if (result.success) {
      setAvailable(Array.isArray(result.data) ? result.data : [])
    } else {
      setAvailable([])
      toast.error({ title: 'Could not fetch terminals', message: result.error || 'Unable to reach Clover.' })
    }
    setFetchingAvailable(false)
  }, [locationID, toast])

  useEffect(() => {
    setAvailable(null)
  }, [locationID])

  async function handlePair(device) {
    setPairingId(device.deviceId)
    const result = await pairDevice(locationID, { deviceId: device.deviceId, name: device.name, serial: device.serial, model: device.model })
    setPairingId(null)
    if (result.success) {
      toast.success({ title: 'Terminal paired', message: `${device.name || device.deviceId} is ready for payments.` })
      await Promise.all([refresh(), loadAvailable()])
    } else {
      toast.error({ title: 'Pairing failed', message: result.error || 'Unable to pair this terminal.' })
    }
  }

  async function handleUnpair(device) {
    setUnpairingId(device._id)
    const result = await unpairDevice(locationID, device._id)
    setUnpairingId(null)
    if (result.success) {
      toast.success({ title: 'Terminal removed', message: `${device.name || device.deviceId} was unpaired.` })
      await refresh()
      setAvailable(null)
    } else {
      toast.error({ title: 'Unpair failed', message: result.error || 'Unable to remove this terminal.' })
    }
  }

  return (
    <article className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-foreground">Clover terminals</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Pair physical Clover devices so staff can send a charge straight to a terminal instead of a hosted checkout link.
        </p>
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
        <p className="mt-4 text-sm text-muted-foreground">Select a location to manage its terminals.</p>
      )}

      {locationID && !connected && (
        <p className="mt-4 text-sm text-muted-foreground">
          Connect Clover for this location above before pairing a terminal.
        </p>
      )}

      {locationID && connected && (
        <div className="mt-4 space-y-4">
          <div>
            <h4 className="text-sm font-medium text-foreground">Paired terminals</h4>
            {loading ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            ) : devices.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No terminals paired yet.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {devices.map((d) => (
                  <li key={d._id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{d.name || d.deviceId}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.model || 'Clover device'}{d.serial ? ` · ${d.serial}` : ''}
                      </p>
                    </div>
                    <Badge variant="secondary">Paired</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-[11px]"
                      disabled={!canDelete || unpairingId === d._id}
                      onClick={() => handleUnpair(d)}
                      title={!canDelete ? 'You do not have permission to remove terminals' : undefined}
                    >
                      {unpairingId === d._id ? 'Removing…' : 'Remove'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-foreground">Available on Clover</h4>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[11px]"
                disabled={fetchingAvailable}
                onClick={loadAvailable}
              >
                {fetchingAvailable ? 'Checking…' : available === null ? 'Check for terminals' : 'Refresh'}
              </Button>
            </div>

            {available !== null && (
              available.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">No devices found on this Clover merchant.</p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {available.map((d) => (
                    <li key={d.deviceId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{d.name || d.deviceId}</p>
                        <p className="text-xs text-muted-foreground">
                          {d.model || 'Clover device'}{d.serial ? ` · ${d.serial}` : ''}
                        </p>
                      </div>
                      {d.paired ? (
                        <Badge variant="secondary">Paired</Badge>
                      ) : (
                        <Button
                          size="sm"
                          className="h-7 px-2.5 text-[11px]"
                          disabled={!canWrite || pairingId === d.deviceId}
                          onClick={() => handlePair(d)}
                          title={!canWrite ? 'You do not have permission to pair terminals' : undefined}
                        >
                          {pairingId === d.deviceId ? 'Pairing…' : 'Pair'}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
        </div>
      )}
    </article>
  )
}
