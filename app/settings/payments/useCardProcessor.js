'use client'

import { useCloverConnection } from '@/app/settings/payments/clover/useCloverConnection'
import { useStripeConnection } from '@/app/settings/payments/stripe/useStripeConnection'

/**
 * Whether this location can take a card payment through *either* processor, and
 * which one the backend will route to. Payment forms should gate the "card"
 * option on `ready` rather than on Clover alone.
 */
export function useCardProcessor(locationID) {
  const clover = useCloverConnection(locationID)
  const stripe = useStripeConnection(locationID)

  const cloverReady = clover.cloverReady
  const stripeReady = stripe.status === 'connected' && stripe.chargesEnabled

  let provider = null
  if (stripe.paymentProvider === 'stripe' && stripeReady) provider = 'stripe'
  else if (stripe.paymentProvider === 'clover' && cloverReady) provider = 'clover'
  else if (stripeReady && !cloverReady) provider = 'stripe'
  else if (cloverReady && !stripeReady) provider = 'clover'
  else if (cloverReady && stripeReady) provider = 'clover' // both, no explicit choice

  return { ready: cloverReady || stripeReady, provider, cloverReady, stripeReady }
}
