'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Check, Lock, Loader2, AlertCircle } from 'lucide-react'

/**
 * The page a customer lands on from the SMS or email we sent them.
 *
 * This is the only screen in the product a paying customer ever sees, and they see it
 * on a phone, from a text message, deciding in about three seconds whether it is real.
 * So it answers exactly three questions — who is asking, how much, and what for — and
 * says plainly that the card is entered on the studio's card processor, not here.
 *
 * Colours are fixed rather than themed on purpose. The theme script sets `.dark` from
 * the visitor's OS preference, and a customer has never set a preference in this app, so
 * a dark phone would otherwise repaint a payment page in the staff dashboard's palette.
 * A page that asks for money must look the same to everyone.
 */

const BRAND = 'hsl(330 74% 45%)' // --primary, kept literal so `.dark` cannot repaint it.

const API_BASE = (
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_BASE_URL) ||
  'http://localhost:8080'
).replace(/\/$/, '')

const money = (amount) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount) || 0)

// Keys are the values getLocationProvider() returns; it also returns null, which falls
// through to the unnamed wording below.
const PROCESSOR_NAMES = { stripe: 'Stripe', clover: 'Clover' }

const CLOSED = {
  paid: {
    tone: 'good',
    title: 'This has been paid',
    body: 'Thank you — there is nothing left to pay. You can close this page.',
  },
  cancelled: {
    tone: 'plain',
    title: 'This payment link was cancelled',
    body: 'The studio cancelled this request. Contact them if you think that is a mistake.',
  },
  expired: {
    tone: 'plain',
    title: 'This payment link has expired',
    body: 'Links are only good for 24 hours. Ask the studio to send you a new one.',
  },
}

function Shell({ children }) {
  return (
    <div
      style={{ colorScheme: 'light' }}
      className="min-h-screen bg-muted/40 px-4 py-10 sm:py-16 flex justify-center"
    >
      <main className="w-full max-w-[26rem]">{children}</main>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="motion-safe:animate-pulse space-y-6">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-2.5 w-20 rounded bg-muted" />
          </div>
        </div>
        <div className="space-y-3 pt-2">
          <div className="h-2.5 w-24 rounded bg-muted" />
          <div className="h-10 w-40 rounded bg-muted" />
          <div className="h-3 w-48 rounded bg-muted" />
        </div>
        <div className="h-12 w-full rounded-xl bg-muted" />
      </div>
      <span className="sr-only">Loading your payment request…</span>
    </div>
  )
}

function StudioMark({ name }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-3">
      <div
        aria-hidden="true"
        style={{ backgroundColor: BRAND }}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg font-semibold text-white"
      >
        {initial}
      </div>
      <div className="min-w-0">
        <h1 className="truncate text-[15px] font-semibold text-foreground">{name}</h1>
        <p className="text-[13px] text-muted-foreground">Payment request</p>
      </div>
    </div>
  )
}

function formatPreferred(slot, timeZone) {
  if (!slot?.start) return null
  try {
    return new Date(slot.start).toLocaleString('en-US', {
      timeZone: timeZone || undefined,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return null
  }
}

export default function PayPage() {
  const { token } = useParams()

  const [state, setState] = useState('loading') // loading | ready | closed | pick-slot | invalid
  const [request, setRequest] = useState(null)
  const [opening, setOpening] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    return fetch(`${API_BASE}/api/pay/${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('invalid')
        return res.json()
      })
      .then((body) => {
        if (!body?.success) throw new Error('invalid')
        setRequest(body.data)
        if (body.data.status === 'sent') {
          setState('ready')
        } else if (body.data.status === 'paid' && body.data.slotSelectionRequired) {
          setState('pick-slot')
          const preferred = body.data.preferredSlot?.start
          const match = (body.data.availableSlots || []).find((s) => s.start === preferred)
          setSelected(match || body.data.availableSlots?.[0] || null)
        } else {
          setState('closed')
        }
      })
  }, [token])

  useEffect(() => {
    let cancelled = false
    load().catch(() => {
      if (!cancelled) setState('invalid')
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const pay = useCallback(async () => {
    setOpening(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/pay/${encodeURIComponent(token)}/session`, {
        method: 'POST',
      })
      const body = await res.json()

      if (body?.success && body.data?.checkoutUrl) {
        window.location.href = body.data.checkoutUrl
        return
      }
      setError(body?.message || 'We could not open the payment page. Please try again.')
    } catch {
      setError('We could not reach the payment page. Check your connection and try again.')
    }
    setOpening(false)
  }, [token])

  const confirmSlot = useCallback(async () => {
    if (!selected?.start || !selected?.end) return
    setConfirming(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/api/pay/${encodeURIComponent(token)}/confirm-slot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ start: selected.start, end: selected.end }),
      })
      const body = await res.json()
      if (body?.success) {
        setRequest((r) => ({ ...r, slotSelectionRequired: false, status: 'paid' }))
        setState('closed')
        return
      }
      setError(body?.message || 'That time is no longer available. Pick another.')
      await load().catch(() => {})
    } catch {
      setError('We could not confirm that time. Please try again.')
    }
    setConfirming(false)
  }, [token, selected, load])

  if (state === 'loading') {
    return (
      <Shell>
        <Skeleton />
      </Shell>
    )
  }

  if (state === 'invalid') {
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
          <AlertCircle aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground" />
          <h1 className="mt-4 text-[15px] font-semibold text-foreground">This link isn’t valid</h1>
          <p className="mx-auto mt-1.5 max-w-[30ch] text-[13px] leading-relaxed text-muted-foreground">
            Open the most recent link your studio sent you, or ask them for a new one.
          </p>
        </div>
      </Shell>
    )
  }

  if (state === 'pick-slot') {
    const slots = request.availableSlots || []
    const preferredLabel = formatPreferred(request.preferredSlot, request.timezone)
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <StudioMark name={request.studioName} />
          <div className="mt-6 border-t border-border pt-6">
            <div className="flex items-center gap-2 text-success">
              <Check className="h-4 w-4" />
              <p className="text-[13px] font-medium">Payment received</p>
            </div>
            <h2 className="mt-3 text-[15px] font-semibold text-foreground">Choose your lesson time</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {preferredLabel
                ? `Your preferred time (${preferredLabel}) is no longer available. Pick another open slot below.`
                : 'Pick an available time for your lesson.'}
            </p>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
              {error}
            </p>
          )}

          <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
            {slots.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                No open times right now. Contact the studio to schedule.
              </p>
            ) : (
              slots.map((s) => {
                const active = selected?.start === s.start
                return (
                  <button
                    key={s.start}
                    type="button"
                    onClick={() => setSelected(s)}
                    className={[
                      'w-full rounded-xl border px-3 py-2.5 text-left text-[13px] transition-colors',
                      active
                        ? 'border-[hsl(330_74%_45%)] bg-[hsl(330_74%_45%/0.08)] font-medium text-foreground'
                        : 'border-border bg-background text-foreground hover:bg-muted/40',
                    ].join(' ')}
                  >
                    {s.label}
                  </button>
                )
              })
            )}
          </div>

          <button
            type="button"
            onClick={confirmSlot}
            disabled={confirming || !selected}
            aria-busy={confirming}
            style={{ backgroundColor: BRAND }}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white disabled:opacity-70"
          >
            {confirming ? (
              <>
                <Loader2 className="h-4 w-4 motion-safe:animate-spin" />
                Confirming…
              </>
            ) : (
              'Confirm this time'
            )}
          </button>
        </div>
      </Shell>
    )
  }

  if (state === 'closed') {
    const closed = CLOSED[request.status] ?? CLOSED.cancelled
    const good = closed.tone === 'good' || request.status === 'paid'
    return (
      <Shell>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
          <StudioMark name={request.studioName} />
          <div className="mt-6 flex flex-col items-center border-t border-border pt-6 text-center">
            <div
              aria-hidden="true"
              className={`flex h-10 w-10 items-center justify-center rounded-full ${
                good ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'
              }`}
            >
              {good ? <Check className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            </div>
            <h2 className="mt-3 text-[15px] font-semibold text-foreground">
              {request.status === 'paid' ? 'You’re all set' : closed.title}
            </h2>
            <p className="mx-auto mt-1.5 max-w-[34ch] text-[13px] leading-relaxed text-muted-foreground">
              {request.status === 'paid'
                ? 'Thanks for your payment. Your lesson booking is confirmed.'
                : closed.body}
            </p>
            {good && (
              <p className="mt-4 text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">{money(request.amount)}</span> ·{' '}
                {request.description}
              </p>
            )}
          </div>
        </div>
      </Shell>
    )
  }

  const preferredLabel = formatPreferred(request.preferredSlot, request.timezone)
  // Named because a stranger trusts "Stripe" more than "our payment provider" — but
  // only ever the processor they will actually land on. The unnamed fallback covers a
  // location with no processor resolved, where guessing a brand would be a lie.
  const processor = PROCESSOR_NAMES[request.provider] || 'our payment provider'

  return (
    <Shell>
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <StudioMark name={request.studioName} />

        <div className="mt-6 border-t border-border pt-6">
          <p className="text-[13px] font-medium text-muted-foreground">Amount due</p>
          <p className="mt-1 text-[2.75rem] font-semibold leading-none tracking-tight text-foreground tabular-nums">
            {money(request.amount)}
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">{request.description}</p>
          {preferredLabel && (
            <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-[13px] leading-relaxed text-foreground">
              Preferred time: <span className="font-medium">{preferredLabel}</span>
              {request.timezone ? (
                <span className="text-muted-foreground"> (studio local time)</span>
              ) : null}
              {request.holdActive
                ? ' — held for you while this link is open (up to 2 hours from when it was sent).'
                : ' — if this time is taken when you pay, you’ll choose another available slot.'}
            </p>
          )}
        </div>

        {error && (
          <p
            role="alert"
            className="mt-5 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] leading-relaxed text-destructive"
          >
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={pay}
          disabled={opening}
          aria-busy={opening}
          style={{ backgroundColor: BRAND }}
          className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white transition-[filter,transform] duration-150 ease-out hover:brightness-110 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(330_74%_45%)] focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:brightness-100 disabled:active:scale-100"
        >
          {opening ? (
            <>
              <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
              Opening secure checkout…
            </>
          ) : (
            `Pay ${money(request.amount)}`
          )}
        </button>

        <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-muted-foreground">
          <Lock aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            You’ll be taken to {processor} to enter your card. {request.studioName} never sees your
            card details. This link works for 24 hours.
          </span>
        </p>
      </div>
    </Shell>
  )
}
