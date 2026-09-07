'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, RotateCcw, X, Infinity as InfinityIcon, ChevronDown, Snowflake } from 'lucide-react'
import api from '@/lib/api'
import { formatStudioDate, formatStudioTime } from '@/lib/studioLocalDate'
import { useStudioTimezone } from '@/lib/hooks/useStudioTimezone'
import { toast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import GlobalLoader from '@/components/shared/GlobalLoader'
import CancelRefundDialog from '@/components/shared/CancelRefundDialog'
import FreezeMembershipDialog from '@/components/shared/FreezeMembershipDialog'
import AssignMembershipForm from './AssignMembershipForm'
import SendPaymentLinkMenu from '@/components/payments/SendPaymentLinkMenu'
import { useCloverConnection } from '@/app/settings/payments/clover/useCloverConnection'
import { openCheckoutTab, navigateCheckoutTab, closeCheckoutTab, CHECKOUT_TOAST } from '@/lib/clover'
import { PAYMENT_METHODS } from '@/lib/paymentMethods'
import WalletShortfallField, { walletPaymentFields } from '@/components/payments/WalletShortfallField'
import { fetchWalletBalance } from '@/lib/wallet'

const ANNUAL_FREEZE_CAP_DAYS = 60

const STATUS_COLORS = {
  active: 'bg-success/10 text-success',
  expired: 'bg-muted text-muted-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  frozen: 'bg-sky-500/10 text-sky-600',
}
const PAYMENT_STATUS_COLORS = {
  paid: 'bg-success/10 text-success',
  partial: 'bg-warning/10 text-warning',
  unpaid: 'bg-destructive/10 text-destructive',
  payment_pending: 'bg-warning/10 text-warning',
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function PayInstallmentDialog({ target, onClose, onPaid, locationID }) {
  const [method, setMethod] = useState('cash')
  const [shortfallMethod, setShortfallMethod] = useState('cash')
  const [walletBalance, setWalletBalance] = useState(0)
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [paying, setPaying] = useState(false)
  const { cloverReady } = useCloverConnection(locationID || target?.plan)

  const customerID = target?.plan?.customerID
  useEffect(() => {
    if (customerID) fetchWalletBalance(customerID?._id ?? customerID).then(setWalletBalance)
  }, [customerID])

  if (!target) return null
  const { plan, index } = target
  const inst = plan.installments[index]
  const amountDue = Number(inst.amount) || 0

  // A wallet short of the installment is topped up by the shortfall method, and that is
  // what reaches Clover — so it decides whether a checkout tab is opened.
  const paymentFields = walletPaymentFields({
    method,
    shortfallMethod,
    balance: walletBalance,
    amountDue,
  })
  const payWithClover = paymentFields.method === 'card' && cloverReady
  const cloverNotConnected = paymentFields.method === 'card' && !cloverReady

  async function handlePay() {
    const checkoutTab = payWithClover ? openCheckoutTab() : null
    setPaying(true)
    try {
      const r = await api.post(`/api/payment-plan/${plan._id}/pay-installment`, {
        installmentIndex: index,
        paymentDate: paymentDate || undefined,
        ...paymentFields,
      })
      if (r.success) {
        if (r.data?.checkoutUrl) {
          navigateCheckoutTab(checkoutTab, r.data.checkoutUrl)
          toast.success(CHECKOUT_TOAST)
        } else {
          closeCheckoutTab(checkoutTab)
          toast.success('Installment paid')
        }
        onPaid()
      } else {
        closeCheckoutTab(checkoutTab)
        toast.error('Payment failed', { description: r.error })
      }
    } finally { setPaying(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[61] w-[420px] rounded-xl border border-border bg-card p-5 shadow-2xl">
        <h3 className="text-sm font-semibold text-foreground mb-1">Record Payment</h3>
        <p className="text-[12px] text-muted-foreground mb-4">
          Payment {index + 1} · <span className="font-semibold text-foreground">${Number(inst.amount).toFixed(2)}</span>
        </p>
        <label className="text-[12px] font-medium text-foreground block mb-1">Method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-background text-sm px-2.5 capitalize focus:outline-none focus:ring-2 focus:ring-brand/30"
        >
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <label className="text-[12px] font-medium text-foreground block mb-1 mt-3">Payment date</label>
        <input
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          className="h-9 w-full rounded-lg border border-border bg-background text-sm px-2.5 focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <WalletShortfallField
          className="mt-2"
          method={method}
          balance={walletBalance}
          amountDue={amountDue}
          shortfallMethod={shortfallMethod}
          onShortfallMethodChange={setShortfallMethod}
        />
        {cloverNotConnected && (
          <p className="mt-2 text-[11px] text-warning">Finish Clover setup in Settings → Integrations to charge a card.</p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onClose} disabled={paying}>Cancel</Button>
          <Button size="sm" onClick={handlePay} disabled={paying || cloverNotConnected} className="bg-success hover:bg-success text-white">
            {paying ? 'Saving…' : payWithClover ? 'Pay with Clover' : `Pay $${Number(inst.amount).toFixed(2)}`}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function CustomerMembershipsTab({ customerID, locationID }) {
  // Lesson times are UTC instants — render them in the studio's zone, never the browser's.
  const studioTz = useStudioTimezone()
  const [memberships, setMemberships] = useState([])
  const [plansMap, setPlansMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [assignOpen, setAssignOpen] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [payTarget, setPayTarget] = useState(null)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [freezeTarget, setFreezeTarget] = useState(null)
  const [freezing, setFreezing] = useState(false)
  const [calendarEvents, setCalendarEvents] = useState([])
  const [expandedServices, setExpandedServices] = useState(new Set())
  const { cloverReady } = useCloverConnection(locationID)

  function toggleService(key) {
    setExpandedServices((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [memRes, planRes, calRes] = await Promise.all([
        api.get(`/api/customer-membership/customer/${customerID}`),
        api.get(`/api/payment-plan/customer/${customerID}`),
        api.get(`/api/calendar/customer/${customerID}`),
      ])
      if (memRes.success) setMemberships(Array.isArray(memRes.data) ? memRes.data : [])
      else toast.error('Failed to load memberships', { description: memRes.error })
      if (calRes.success && Array.isArray(calRes.data)) setCalendarEvents(calRes.data)

      const map = {}
      if (planRes.success && Array.isArray(planRes.data)) {
        for (const plan of planRes.data) {
          if (plan.customerMembershipID) map[String(plan.customerMembershipID)] = plan
        }
      }
      setPlansMap(map)
    } catch {
      toast.error('Error', { description: 'Unable to load memberships' })
    } finally {
      setLoading(false)
    }
  }, [customerID])

  useEffect(() => { load() }, [load])

  async function handleCancel(refundOption, refundAmount) {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      const r = await api.patch(`/api/customer-membership/${cancelTarget._id}/cancel`, { refundOption, refundAmount })
      if (r.success) { toast.success('Membership cancelled'); setCancelTarget(null); load() }
      else toast.error('Failed', { description: r.error })
    } finally { setCancelling(false) }
  }

  async function handleFreeze(startDate, endDate) {
    if (!freezeTarget) return
    setFreezing(true)
    try {
      const r = await api.patch(`/api/customer-membership/${freezeTarget._id}/freeze`, { startDate, endDate })
      if (r.success) { toast.success('Membership frozen'); setFreezeTarget(null); load() }
      else toast.error('Failed', { description: r.error })
    } finally { setFreezing(false) }
  }

  async function handleUnfreeze(m) {
    setBusyId(m._id)
    try {
      const r = await api.patch(`/api/customer-membership/${m._id}/unfreeze`)
      if (r.success) { toast.success('Membership unfrozen'); load() }
      else toast.error('Failed', { description: r.error })
    } finally { setBusyId(null) }
  }

  async function handleRenew(m) {
    setBusyId(m._id)
    try {
      const r = await api.patch(`/api/customer-membership/${m._id}/renew`)
      if (r.success) { toast.success('Membership renewed'); load() }
      else toast.error('Failed', { description: r.error })
    } finally { setBusyId(null) }
  }

  async function handleToggleAutoRenew(m) {
    setBusyId(m._id)
    try {
      const r = await api.patch(`/api/customer-membership/${m._id}/auto-renew`, { autoRenew: !m.autoRenew })
      if (r.success) { toast.success(`Auto-renew ${!m.autoRenew ? 'enabled' : 'disabled'}`); load() }
      else toast.error('Failed', { description: r.error })
    } finally { setBusyId(null) }
  }

  if (loading && memberships.length === 0) {
    return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading memberships…" /></div>
  }

  return (
    <div className="py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Memberships</h2>
          <p className="text-[12px] text-muted-foreground">A customer can hold multiple memberships (not combinable with packages).</p>
        </div>
        <Button
          onClick={() => setAssignOpen(true)}
          className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2"
        >
          <Plus className="h-4 w-4" />
          Assign Membership
        </Button>
      </div>

      {memberships.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted-foreground border border-dashed border-border rounded-xl">
          No memberships yet. Click "Assign Membership" to add one.
        </div>
      ) : (
        <div className="space-y-4">
          {memberships.map((m) => {
            const plan = plansMap[String(m._id)]
            const collected = Number(m.amountCollected ?? 0)
            const total = Number(m.totalPaid ?? 0)
            const outstanding = Math.max(0, total - collected)
            return (
            <div key={m._id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: m.membershipID?.color || '#6366f1' }}>
                    {(m.membershipName || '?').charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{m.membershipName}</p>
                    <p className="text-[12px] text-muted-foreground">
                      Purchased {fmtDate(m.purchaseDate)} · {m.expiryDate ? `Renews ${fmtDate(m.expiryDate)}` : 'No expiry'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium', PAYMENT_STATUS_COLORS[m.paymentStatus] || 'bg-muted text-muted-foreground'].join(' ')}>
                    {m.paymentStatus === 'payment_pending' ? 'payment pending' : m.paymentStatus}
                  </span>
                  <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize', STATUS_COLORS[m.status] || 'bg-muted text-muted-foreground'].join(' ')}>
                    {m.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-4 text-[12px]">
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-muted-foreground">Price</p>
                  <p className="text-sm font-semibold text-foreground">${total.toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-muted-foreground">Collected</p>
                  <p className="text-sm font-semibold text-success">${collected.toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-muted-foreground">Outstanding</p>
                  <p className="text-sm font-semibold text-destructive">${outstanding.toFixed(2)}</p>
                </div>
                <div className="rounded-lg bg-muted/30 px-3 py-2">
                  <p className="text-muted-foreground">Billing</p>
                  <p className="text-sm font-medium text-foreground capitalize">{(m.billingType || '').replace(/_/g, ' ')}</p>
                </div>
              </div>

              <div className="space-y-1.5 mb-4">
                {(m.services || []).map((s, i) => {
                  const expandKey = `${m._id}-${i}`
                  const isExpanded = expandedServices.has(expandKey)
                  const svcEvents = calendarEvents
                    .filter((e) => {
                      const cs = e.calendarServiceID
                      if (!cs) return false
                      const matchesService = s.serviceCode ? cs.serviceCode === s.serviceCode : cs.serviceName === s.serviceName
                      if (!matchesService) return false
                      const charge = (e.charges || []).find(
                        (c) => String(c.customerID) === String(customerID) && c.method === 'membership',
                      )
                      if (!charge) return false
                      const chargedMembershipId = charge.customerMembershipID?._id ?? charge.customerMembershipID
                      return String(chargedMembershipId) === String(m._id)
                    })
                    .sort((a, b) => new Date(b.startDateTime) - new Date(a.startDateTime))
                  return (
                    <div key={i} className="border-b border-border/50 last:border-0">
                      <div
                        className="flex items-center gap-2 text-[12px] py-1.5 cursor-pointer hover:bg-muted/20 -mx-1 px-1 rounded"
                        onClick={() => toggleService(expandKey)}
                      >
                        <ChevronDown className={`h-3 w-3 text-muted-foreground shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color || '#6366f1' }} />
                        <span className="text-foreground">{s.serviceName}</span>
                        <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                          {s.accessType === 'unlimited' ? (
                            <><InfinityIcon className="h-3.5 w-3.5" /> Unlimited</>
                          ) : (
                            <span className="font-medium text-foreground">{s.sessionsRemaining} / {s.sessionsTotal} left</span>
                          )}
                        </span>
                      </div>
                      {isExpanded && (
                        <div className="pb-2 pl-5">
                          {svcEvents.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground py-1.5">No lessons scheduled yet for this service.</p>
                          ) : (
                            <div className="rounded-lg border border-border overflow-hidden">
                              <div className="grid grid-cols-[1fr_120px_130px] gap-2 bg-muted/50 border-b border-border px-2.5 py-1.5">
                                {['Date & Time', 'Teacher', 'Status'].map((h) => (
                                  <span key={h} className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">{h}</span>
                                ))}
                              </div>
                              {svcEvents.map((ev, idx) => (
                                <div key={ev._id} className={`grid grid-cols-[1fr_120px_130px] gap-2 items-center px-2.5 py-1.5 ${idx > 0 ? 'border-t border-border/50' : ''}`}>
                                  <span className="text-[11px] text-foreground">
                                    {formatStudioDate(ev.startDateTime, studioTz, { year: 'numeric' })}
                                    {' · '}
                                    {formatStudioTime(ev.startDateTime, studioTz)}
                                  </span>
                                  <span className="text-[11px] text-muted-foreground truncate">{ev.teacherID?.name || '—'}</span>
                                  <span className={`inline-flex w-fit max-w-full items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase leading-tight whitespace-normal text-center ${
                                    ev.status === 'completed' ? 'bg-info/10 text-info'
                                      : ev.status?.startsWith('cancelled') ? 'bg-destructive/10 text-destructive'
                                        : ev.status === 'no_show' ? 'bg-warning/10 text-warning'
                                          : 'bg-violet-500/10 text-violet-500'}`}>
                                    {(ev.status || 'scheduled').replace(/_/g, ' ')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Payment schedule (payment plan, or flexible billing with a tracked schedule) */}
              {plan && (
                <div className="mt-4 border-t border-border pt-4">
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Payment Schedule</p>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        plan.status === 'completed' ? 'bg-success/10 text-success'
                          : plan.status === 'cancelled' ? 'bg-muted text-muted-foreground'
                            : 'bg-violet-500/10 text-violet-600'}`}>
                        {plan.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {plan.installments.filter((i) => i.status === 'paid').length} / {plan.numberOfInstallments} paid
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border overflow-hidden">
                    {plan.installments.map((inst, idx) => (
                      <div
                        key={idx}
                        className={`flex items-center justify-between px-3 py-2.5 ${idx > 0 ? 'border-t border-border' : ''} ${inst.status === 'paid' ? 'bg-success/5' : ''}`}
                      >
                        <div className="flex items-center gap-2.5">
                          <div className={`h-5 w-5 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
                            inst.status === 'paid' ? 'bg-success text-white'
                              : inst.status === 'failed' ? 'bg-rose-600 text-white'
                                : inst.status === 'payment_pending' ? 'bg-warning text-white'
                                  : 'bg-muted text-muted-foreground'}`}>
                            {inst.status === 'paid' ? '✓' : inst.status === 'payment_pending' ? '⋯' : idx + 1}
                          </div>
                          <div>
                            <p className="text-[12px] text-foreground font-medium">
                              Payment {idx + 1}
                              {inst.status === 'paid' && <span className="ml-1.5 text-[11px] font-normal text-success">Paid</span>}
                              {inst.status === 'payment_pending' && <span className="ml-1.5 text-[11px] font-normal text-warning">Payment pending</span>}
                            </p>
                            <p className="text-[11px] text-muted-foreground">Due {fmtDate(inst.dueDate)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-semibold text-foreground">${Number(inst.amount).toFixed(2)}</p>
                          {inst.status === 'pending' && plan.status === 'active' && m.status === 'active' && (
                            <>
                              {cloverReady && (
                                <SendPaymentLinkMenu
                                  customerID={customerID}
                                  target={{ kind: 'installment', paymentPlanID: plan._id, installmentIndex: idx }}
                                  onSent={load}
                                />
                              )}
                              <Button
                                size="sm"
                                className="h-7 px-2.5 text-[11px] bg-success hover:bg-success text-white"
                                onClick={() => setPayTarget({ plan, index: idx })}
                              >
                                Pay
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {plan.nextPaymentDate && plan.status === 'active' && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">Next payment due: {fmtDate(plan.nextPaymentDate)}</p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-3 border-t border-border mt-1">
                <label className="flex items-center gap-2 text-[12px] text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!m.autoRenew}
                    disabled={m.status !== 'active' || busyId === m._id}
                    onChange={() => handleToggleAutoRenew(m)}
                    className="accent-brand"
                  />
                  Auto-renew
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === m._id || m.status === 'cancelled'}
                    onClick={() => handleRenew(m)}
                    className="h-8 gap-1.5 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Renew
                  </Button>
                  {m.status === 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === m._id}
                      onClick={() => setFreezeTarget({
                        _id: m._id,
                        membershipName: m.membershipName,
                        freezeCapDays: m.durationDays >= 365 ? ANNUAL_FREEZE_CAP_DAYS : null,
                        freezeDaysUsed: (m.freezes || []).reduce((sum, f) => sum + f.days, 0),
                      })}
                      className="h-8 gap-1.5 text-xs text-sky-600 hover:text-sky-700"
                    >
                      <Snowflake className="h-3.5 w-3.5" />
                      Freeze
                    </Button>
                  )}
                  {m.status === 'frozen' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === m._id}
                      onClick={() => handleUnfreeze(m)}
                      className="h-8 gap-1.5 text-xs text-sky-600 hover:text-sky-700"
                    >
                      <Snowflake className="h-3.5 w-3.5" />
                      Unfreeze{m.frozenUntil ? ` (until ${fmtDate(m.frozenUntil)})` : ''}
                    </Button>
                  )}
                  {m.status === 'active' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === m._id}
                      onClick={() => setCancelTarget({ _id: m._id, membershipName: m.membershipName, maxRefundable: Math.max(0, collected - Number(m.totalRefunded ?? 0)) })}
                      className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )})}
        </div>
      )}

      <Sheet open={assignOpen} onClose={() => setAssignOpen(false)} width="560px">
        <SheetContent onClose={() => setAssignOpen(false)} className="p-0">
          <div className="shrink-0 border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-foreground">Assign Membership</h2>
            <p className="text-sm text-muted-foreground">Grant this customer daily access to a set of services.</p>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <AssignMembershipForm
              customerID={customerID}
              locationID={locationID}
              onCancel={() => setAssignOpen(false)}
              onSuccess={() => { setAssignOpen(false); load() }}
            />
          </div>
        </SheetContent>
      </Sheet>

      <PayInstallmentDialog target={payTarget} locationID={locationID} onClose={() => setPayTarget(null)} onPaid={() => { setPayTarget(null); load() }} />

      <CancelRefundDialog
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="Cancel Membership"
        itemName={cancelTarget?.membershipName}
        maxRefundable={cancelTarget?.maxRefundable ?? 0}
        submitting={cancelling}
        onConfirm={handleCancel}
      />

      <FreezeMembershipDialog
        open={Boolean(freezeTarget)}
        onClose={() => setFreezeTarget(null)}
        itemName={freezeTarget?.membershipName}
        freezeCapDays={freezeTarget?.freezeCapDays}
        freezeDaysUsed={freezeTarget?.freezeDaysUsed}
        submitting={freezing}
        onConfirm={handleFreeze}
      />
    </div>
  )
}
