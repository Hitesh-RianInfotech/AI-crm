'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import MainLayout from '@/components/layout/MainLayout'
import { useToast } from '@/components/ui/toast'
import CloverConnectionCard from '@/app/settings/payments/clover/CloverConnectionCard'
import CloverDeviceManager from '@/app/settings/payments/clover/CloverDeviceManager'
import StripeConnectionCard from '@/app/settings/payments/stripe/StripeConnectionCard'
import StripeReaderManager from '@/app/settings/payments/stripe/StripeReaderManager'

function CloverCallbackStatusHandler() {
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
      const reason = searchParams.get('reason')
      toast.error({
        title: `${provider} connection failed`,
        message: reason || `Unable to complete the ${provider} connection.`,
      })
    }

    router.replace('/settings/integrations')
  }, [searchParams, router, toast])

  return null
}

export default function IntegrationsPage() {
  return (
    <MainLayout
      title="Integrations"
      subtitle="Connect payments for this studio. Studio phone numbers are set under Settings → Studio."
    >
      <Suspense fallback={null}>
        <CloverCallbackStatusHandler />
      </Suspense>
      <div className="space-y-4">
        <CloverConnectionCard />
        <CloverDeviceManager />
        <StripeConnectionCard />
        <StripeReaderManager />
      </div>
    </MainLayout>
  )
}
