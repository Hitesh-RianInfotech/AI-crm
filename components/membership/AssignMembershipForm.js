'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCardProcessor } from '@/app/settings/payments/useCardProcessor'
import { openCheckoutTab, navigateCheckoutTab, closeCheckoutTab, CHECKOUT_TOAST } from '@/lib/clover'

import { PURCHASE_METHODS } from '@/lib/paymentMethods'

// Shared membership-assignment form. Used inside the customer Memberships tab and
// the enroll menu's Membership tab.
export default function AssignMembershipForm({ customerID, locationID, onSuccess, onCancel }) {
  const [templates, setTemplates] = useState([])
  const [membershipID, setMembershipID] = useState('')
  const [billingType, setBillingType] = useState('one_time')
  const [method, setMethod] = useState('cash')
  const [dueDate, setDueDate] = useState('')
  const [scheduleMode, setScheduleMode] = useState('single')
  const [customInstallments, setCustomInstallments] = useState([])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [walletBalance, setWalletBalance] = useState(null)
  const [useWallet, setUseWallet] = useState(false)
  const [walletAmount, setWalletAmount] = useState('')
  const { ready: cloverReady } = useCardProcessor(locationID)

  useEffect(() => {
    api.get('/api/membership?isActive=true&limit=200').then((res) => {
      if (res.success) setTemplates(Array.isArray(res.data) ? res.data : [])
    })
  }, [])

  useEffect(() => {
    if (!customerID) { setWalletBalance(null); return }
    api.get(`/api/wallet/${customerID}/balance`).then((res) => {
      if (res.success) setWalletBalance(Number(res.data?.balance ?? 0))
    })
  }, [customerID])

  const selected = templates.find((t) => t._id === membershipID)
  const price = Number(selected?.price ?? 0)

  // How much of the one-time price is paid from the wallet vs. the chosen method.
  const walletEligible = billingType === 'one_time' && useWallet && walletBalance != null
  const walletEntered = walletEligible ? Number(walletAmount) || 0 : 0
  const walletApplied = Math.min(walletEntered, price, walletBalance ?? 0)
  const remaining = Math.max(0, price - walletApplied)
  const walletOver = walletEligible && walletEntered > (walletBalance ?? 0)

  // One-time card purchases settle through Clover's hosted page; everything else
  // (cash, wallet, flexible schedules) is recorded directly.
  const payWithClover =
    billingType === 'one_time' && method === 'card' && remaining > 0 && cloverReady
  const cloverNotConnected =
    billingType === 'one_time' && method === 'card' && remaining > 0 && !cloverReady

  const customTotal = useMemo(
    () => customInstallments.reduce((sum, c) => sum + (Number(c.amount) || 0), 0),
    [customInstallments],
  )

  function addInstallment() {
    setCustomInstallments((prev) => [
      ...prev,
      { _key: String(Date.now() + Math.random()), dueDate: '', amount: '' },
    ])
  }
  function updateInstallment(key, field, value) {
    setCustomInstallments((prev) => prev.map((c) => (c._key === key ? { ...c, [field]: value } : c)))
  }
  function removeInstallment(key) {
    setCustomInstallments((prev) => prev.filter((c) => c._key !== key))
  }

  async function handleSubmit() {
    if (!customerID) { toast.error('Select a student first'); return }
    if (!membershipID) { toast.error('Select a membership'); return }
    if (walletOver) {
      toast.error('Insufficient wallet balance', { description: `Wallet has $${walletBalance.toFixed(2)} but you entered $${walletEntered.toFixed(2)}.` })
      return
    }

    const billing = {}
    if (billingType === 'one_time') {
      billing.method = method
      if (walletApplied > 0) billing.walletAmount = walletApplied
    }
    else if (billingType === 'flexible') {
      if (scheduleMode === 'custom') {
        const valid = customInstallments.filter((c) => c.dueDate && Number(c.amount) > 0)
        if (valid.length === 0) { toast.error('Add at least one scheduled payment with a date and amount'); return }
        if (Math.abs(customTotal - price) > 0.01) {
          toast.error(`Scheduled payments total $${customTotal.toFixed(2)} but the price is $${price.toFixed(2)}`); return
        }
        billing.customInstallments = valid.map((c) => ({ dueDate: c.dueDate, amount: Number(c.amount) }))
      } else {
        if (!dueDate) { toast.error('Due date is required for flexible billing'); return }
        billing.dueDate = dueDate
      }
    }

    const checkoutTab = payWithClover ? openCheckoutTab() : null
    setSubmitting(true)
    try {
      const result = await api.post('/api/customer-membership', {
        customerID,
        membershipID,
        billingType,
        billing,
        notes: notes.trim() || undefined,
      })
      if (result.success) {
        if (result.data?.checkoutUrl) {
          navigateCheckoutTab(checkoutTab, result.data.checkoutUrl)
          toast.success(CHECKOUT_TOAST)
        } else {
          closeCheckoutTab(checkoutTab)
          toast.success('Membership assigned')
        }
        onSuccess?.()
      } else {
        closeCheckoutTab(checkoutTab)
        toast.error('Failed to assign membership', { description: result.error })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-1.5">
        <Label>Membership *</Label>
        <select
          value={membershipID}
          onChange={(e) => setMembershipID(e.target.value)}
          className="h-9 rounded-lg border border-border bg-background text-sm px-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          <option value="">Select a membership…</option>
          {templates.map((t) => (
            <option key={t._id} value={t._id}>
              {t.membershipName} — ${Number(t.price ?? 0).toFixed(2)} / {t.durationDays}d
            </option>
          ))}
        </select>
      </div>

      {selected && (
        <div className="rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">{selected.membershipName}</span>
            <span className="text-sm font-semibold text-foreground">${Number(selected.price ?? 0).toFixed(2)}</span>
          </div>
          <p className="text-[12px] text-muted-foreground mb-3">
            {selected.durationDays} days · {selected.autoRenew ? 'auto-renews' : 'no auto-renew'}
          </p>
          <div className="space-y-1.5">
            {(selected.services || []).map((s, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color || '#6366f1' }} />
                <span className="text-foreground">{s.serviceName}</span>
                <span className="ml-auto text-muted-foreground">
                  {s.accessType === 'unlimited' ? 'Unlimited' : `${s.numberOfSessions} sessions`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Billing</Label>
        <div className="inline-flex rounded-lg border border-border bg-background p-0.5 w-fit">
          {[
            { v: 'one_time', label: 'One-time' },
            { v: 'flexible', label: 'Flexible' },
          ].map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setBillingType(opt.v)}
              className={[
                'h-8 px-3 rounded-md text-[12px] font-medium transition-colors',
                billingType === opt.v ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {billingType === 'one_time' && (
        <div className="space-y-3">
          {walletBalance != null && walletBalance > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-[12px] font-medium text-foreground">
                  Use wallet balance
                  <span className="text-muted-foreground font-normal"> (${walletBalance.toFixed(2)} available)</span>
                </span>
                <input
                  type="checkbox"
                  checked={useWallet}
                  onChange={(e) => {
                    setUseWallet(e.target.checked)
                    setWalletAmount(e.target.checked ? String(Math.min(price, walletBalance).toFixed(2)) : '')
                  }}
                  className="h-4 w-4 accent-brand"
                />
              </label>
              {useWallet && (
                <>
                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[12px] text-muted-foreground">$</span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      max={Math.min(price, walletBalance)}
                      value={walletAmount}
                      onChange={(e) => setWalletAmount(e.target.value)}
                      className="h-8 pl-5"
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">From wallet</span>
                    <span className="font-medium text-foreground">${walletApplied.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Remaining ({method})</span>
                    <span className="font-semibold text-foreground">${remaining.toFixed(2)}</span>
                  </div>
                  {walletOver && (
                    <p className="text-[10px] text-destructive">Amount exceeds wallet balance.</p>
                  )}
                </>
              )}
            </div>
          )}

          {remaining > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>{walletApplied > 0 ? 'Remaining payment method' : 'Payment Method'}</Label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 rounded-lg border border-border bg-background text-sm px-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30 capitalize"
              >
                {PURCHASE_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
          )}

        </div>
      )}

      {billingType === 'flexible' && (
        <div className="space-y-3">
          <div className="inline-flex rounded-lg border border-border bg-background p-0.5">
            {[
              { v: 'single', label: 'Single due date' },
              { v: 'custom', label: 'Scheduled payments' },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setScheduleMode(opt.v)}
                className={[
                  'h-7 px-3 rounded-md text-[11px] font-medium transition-colors',
                  scheduleMode === opt.v ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {scheduleMode === 'custom' ? (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Add any number of payments, each with its own date and amount. Each is tracked and collected individually.
              </p>
              {customInstallments.map((c, i) => (
                <div key={c._key} className="flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                  <Input type="date" value={c.dueDate} onChange={(e) => updateInstallment(c._key, 'dueDate', e.target.value)} className="h-8 flex-1" />
                  <div className="relative w-28">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={c.amount} onChange={(e) => updateInstallment(c._key, 'amount', e.target.value)} className="h-8 w-full pl-5" />
                  </div>
                  <button type="button" onClick={() => removeInstallment(c._key)} className="text-muted-foreground hover:text-destructive transition-colors" aria-label="Remove payment">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addInstallment}
                className="flex items-center gap-1 h-7 px-2 rounded border border-dashed border-border bg-background text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-brand transition-colors"
              >
                <Plus className="h-3 w-3" /> Add Payment
              </button>
              <div className="rounded-lg border border-border bg-muted/20 p-2.5 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Scheduled total</span>
                  <span className={`text-[12px] font-semibold ${Math.abs(customTotal - price) > 0.01 ? 'text-destructive' : 'text-foreground'}`}>
                    ${customTotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">Membership price</span>
                  <span className="text-[12px] font-bold text-foreground">${price.toFixed(2)}</span>
                </div>
                {Math.abs(customTotal - price) > 0.01 && (
                  <p className="text-[10px] text-destructive">Scheduled payments must add up to the membership price.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>Due Date *</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-9" />
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label>Notes</Label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="h-9" />
      </div>

      <div className="flex flex-col gap-1.5 pt-2">
        {cloverNotConnected && (
          <p className="text-[11px] text-amber-600 text-right">Connect a card processor (Clover or Stripe) in Settings → Integrations to charge a card.</p>
        )}
        <div className="flex justify-end gap-2">
          {onCancel && <Button variant="outline" onClick={onCancel} disabled={submitting}>Cancel</Button>}
          <Button onClick={() => handleSubmit()} disabled={submitting || walletOver || cloverNotConnected} className="bg-brand hover:bg-brand-dark text-brand-foreground">
            {submitting ? 'Assigning…' : payWithClover ? 'Pay by card' : 'Assign Membership'}
          </Button>
        </div>
      </div>
    </div>
  )
}
