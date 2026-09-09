'use client'

import { useEffect, useState } from 'react'

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '')

export default function PaymentCompletePage() {
  const [state, setState] = useState('checking') // checking | done

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('session_id')
    if (!sessionId || params.get('provider') !== 'stripe') { setState('done'); return }
    // Backstop in case the webhook was missed — settles the payment server-side.
    fetch(`${API}/api/payments/stripe/verify?session_id=${encodeURIComponent(sessionId)}`)
      .catch(() => {})
      .finally(() => setState('done'))
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400 text-2xl">
          ✓
        </div>
        <h1 className="text-lg font-semibold text-foreground">Payment received</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {state === 'checking'
            ? 'Confirming your payment…'
            : 'Thank you. Your payment has been recorded. You can close this window.'}
        </p>
      </div>
    </main>
  )
}
