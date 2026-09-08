'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { resolveLocationID } from '@/app/settings/payments/clover/useCloverConnection'

const initialState = {
  status: 'loading',
  configured: true,
  accountName: null,
  accountId: null,
  chargesEnabled: false,
  detailsSubmitted: false,
  connectedAt: null,
  webhookLastReceivedAt: null,
  paymentProvider: null,
  lastError: null,
}

export function useStripeConnection(locationID) {
  const [state, setState] = useState(initialState)
  const resolvedLocationID = resolveLocationID(locationID)

  const refresh = useCallback(async () => {
    if (!resolvedLocationID) {
      setState({ ...initialState, status: 'disconnected' })
      return
    }
    setState((prev) => ({ ...prev, status: 'loading' }))
    const res = await api.get(`/api/payments/stripe/status?locationID=${encodeURIComponent(resolvedLocationID)}`)
    if (res.success && res.data) {
      setState({
        status: res.data.connected ? 'connected' : 'disconnected',
        configured: res.data.configured !== false,
        accountName: res.data.accountName ?? null,
        accountId: res.data.accountId ?? null,
        chargesEnabled: Boolean(res.data.chargesEnabled),
        detailsSubmitted: Boolean(res.data.detailsSubmitted),
        connectedAt: res.data.connectedAt ?? null,
        webhookLastReceivedAt: res.data.webhookLastReceivedAt ?? null,
        paymentProvider: res.data.paymentProvider ?? null,
        lastError: null,
      })
    } else {
      setState({ ...initialState, status: 'disconnected', lastError: res.error || null })
    }
  }, [resolvedLocationID])

  useEffect(() => { refresh() }, [refresh])

  const connect = useCallback(async () => {
    if (!resolvedLocationID) return { success: false, error: 'Select a location first.' }
    const res = await api.get(`/api/payments/stripe/connect?locationID=${encodeURIComponent(resolvedLocationID)}`)
    if (res.success && res.data?.authorizeUrl) {
      window.location.href = res.data.authorizeUrl
      return { success: true }
    }
    return { success: false, error: res.error || 'Unable to start the Stripe connection.' }
  }, [resolvedLocationID])

  const disconnect = useCallback(async () => {
    if (!resolvedLocationID) return { success: false, error: 'Select a location first.' }
    const res = await api.post('/api/payments/stripe/disconnect', { locationID: resolvedLocationID })
    if (res.success) await refresh()
    return { success: res.success, error: res.error }
  }, [resolvedLocationID, refresh])

  const setProvider = useCallback(async (provider) => {
    if (!resolvedLocationID) return { success: false, error: 'Select a location first.' }
    const res = await api.post('/api/payments/stripe/provider', { provider, locationID: resolvedLocationID })
    if (res.success) await refresh()
    return { success: res.success, error: res.error }
  }, [resolvedLocationID, refresh])

  return { ...state, refresh, connect, disconnect, setProvider }
}
