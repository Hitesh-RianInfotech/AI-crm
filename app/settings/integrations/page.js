'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MainLayout from '@/components/layout/MainLayout'
import { useToast } from '@/components/ui/toast'
import LocationSelector from '@/components/shared/LocationSelector'
import CloverConnectionCard from '@/app/settings/payments/clover/CloverConnectionCard'
import CloverDeviceManager from '@/app/settings/payments/clover/CloverDeviceManager'
import StripeConnectionCard from '@/app/settings/payments/stripe/StripeConnectionCard'
import StripeReaderManager from '@/app/settings/payments/stripe/StripeReaderManager'
import { useCloverConnection, resolveLocationID } from '@/app/settings/payments/clover/useCloverConnection'
import { useStripeConnection } from '@/app/settings/payments/stripe/useStripeConnection'

function ConnectCallbackToast() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()

  useEffect(() => {
    const status = searchParams.get('status')
    if (!status) return
    const provider = searchParams.get('provider') === 'stripe' ? 'Stripe' : 'Clover'
    if (status === 'connected') {
      toast.success({ title: `${provider} connected`, message: `This location is now connected to ${provider}.` })
    } else if (status === 'error') {
      toast.error({
        title: `${provider} connection failed`,
        message: searchParams.get('reason') || `Unable to complete the ${provider} connection.`,
      })
    }
    router.replace('/settings/integrations')
  }, [searchParams, router, toast])

  return null
}

function StatusDot({ status }) {
  const cls = status === 'connected'
    ? 'bg-emerald-500'
    : status === 'error'
      ? 'bg-red-500'
      : 'bg-muted-foreground/40'
  return <span className={`h-1.5 w-1.5 rounded-full ${cls}`} />
}

const PROVIDERS = [
  { id: 'clover', label: 'Clover' },
  { id: 'stripe', label: 'Stripe' },
]

function IntegrationsContent() {
  const searchParams = useSearchParams()
  const [locationID, setLocationID] = useState(null)
  const [provider, setProvider] = useState(() =>
    searchParams.get('provider') === 'stripe' ? 'stripe' : 'clover',
  )
  const resolved = resolveLocationID(locationID)

  const clover = useCloverConnection(resolved)
  const stripe = useStripeConnection(resolved)
  const statusFor = { clover: clover.status, stripe: stripe.status }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <ConnectCallbackToast />

      {/* Location — shared across all providers */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <label className="mb-1.5 block text-sm font-medium text-foreground">Studio location</label>
        <p className="mb-2 text-xs text-muted-foreground">
          Payments are configured per location — this is separate from the header view filter.
        </p>
        <div className="max-w-sm">
          <LocationSelector
            value={locationID}
            onChange={setLocationID}
            multiple={false}
            showAllOption={false}
            placeholder="Select a location…"
          />
        </div>
      </div>

      {!resolved ? (
        <p className="text-sm text-muted-foreground">Select a location to configure its payment providers.</p>
      ) : (
        <>
          {/* Provider switcher */}
          <div className="flex items-center gap-1 rounded-full border border-border bg-card p-1 w-fit">
            {PROVIDERS.map((p) => {
              const active = provider === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setProvider(p.id)}
                  className={[
                    'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                    active ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground',
                  ].join(' ')}
                >
                  <StatusDot status={statusFor[p.id]} />
                  {p.label}
                </button>
              )
            })}
          </div>

          {provider === 'clover' && (
            <div className="space-y-4">
              <CloverConnectionCard locationID={resolved} />
              <CloverDeviceManager locationID={resolved} />
            </div>
          )}

          {provider === 'stripe' && (
            <div className="space-y-4">
              <StripeConnectionCard locationID={resolved} />
              <StripeReaderManager locationID={resolved} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function IntegrationsPage() {
  return (
    <MainLayout
      title="Integrations"
      subtitle="Connect payment providers for this studio. Studio phone numbers are set under Settings → Studio."
    >
      <Suspense fallback={null}>
        <IntegrationsContent />
      </Suspense>
    </MainLayout>
  )
}
