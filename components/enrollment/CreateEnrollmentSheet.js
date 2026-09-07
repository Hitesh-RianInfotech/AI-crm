'use client'

import { useEffect, useMemo, useState } from 'react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import SearchableSelect from '@/components/ui/searchable-select'
import NewEnrollmentPackageInline from '@/app/calendar/components/NewEnrollmentPackageInline'
import AssignMembershipForm from '@/components/membership/AssignMembershipForm'
import api from '@/lib/api'

const SHEET_WIDTH = '640px'

export default function CreateEnrollmentSheet({
  open,
  onClose,
  /** When set, student is fixed and the selector is hidden. */
  customerID: fixedCustomerID = null,
  customerName = '',
  /** Studio for Clover readiness when student is fixed (customer location). */
  locationID: fixedLocationID = null,
  /** When set, only group/specific service lines are sellable and only packages containing them are listed. */
  allowedServiceCodes = null,
  onSuccess,
}) {
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState('service')
  const [selectedCustomerID, setSelectedCustomerID] = useState('')
  const [teacherOptions, setTeacherOptions] = useState([])
  const [customerOptions, setCustomerOptions] = useState([])
  const [packageTemplates, setPackageTemplates] = useState([])

  const resolvedCustomerID = fixedCustomerID
    ? String(fixedCustomerID)
    : selectedCustomerID

  const resolvedLocationID = (() => {
    if (fixedLocationID) return String(fixedLocationID)
    const opt = customerOptions.find((c) => c.value === selectedCustomerID)
    return opt?.locationID || null
  })()

  const sellablePackages = useMemo(() => {
    if (!allowedServiceCodes) return packageTemplates
    return packageTemplates.filter((p) =>
      (p.services || []).some((s) => allowedServiceCodes.has(s.serviceCode)),
    )
  }, [packageTemplates, allowedServiceCodes])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    async function loadOptions() {
      setError('')
      const requests = [
        api.get('/api/teacher?limit=200&status=active'),
        api.get('/api/package?limit=200'),
      ]
      if (!fixedCustomerID) {
        requests.splice(1, 0, api.get('/api/customer?limit=200'))
      }

      const results = await Promise.all(requests)
      if (cancelled) return

      let teachersRes
      let customersRes
      let packagesRes

      if (fixedCustomerID) {
        ;[teachersRes, packagesRes] = results
      } else {
        ;[teachersRes, customersRes, packagesRes] = results
      }

      if (teachersRes?.success && Array.isArray(teachersRes.data)) {
        setTeacherOptions(
          teachersRes.data.map((t) => ({
            value: String(t._id ?? t.id),
            label: t.name || t.email || String(t._id),
          })),
        )
      }
      if (customersRes?.success && Array.isArray(customersRes.data)) {
        setCustomerOptions(
          customersRes.data.map((c) => {
            const loc = c.locationID
            const locationID = Array.isArray(loc)
              ? (loc[0]?._id || loc[0] || null)
              : (loc?._id || loc || null)
            return {
              value: String(c._id ?? c.id),
              label: c.name || c.email || String(c._id),
              locationID: locationID ? String(locationID) : null,
            }
          }),
        )
      }
      if (packagesRes?.success && Array.isArray(packagesRes.data)) {
        setPackageTemplates(packagesRes.data)
      }
    }

    loadOptions()
    return () => {
      cancelled = true
    }
  }, [open, fixedCustomerID])

  const selectedCustomerLabel = useMemo(() => {
    if (fixedCustomerID && customerName) return customerName
    const opt = customerOptions.find((c) => c.value === selectedCustomerID)
    return opt?.label || ''
  }, [fixedCustomerID, customerName, customerOptions, selectedCustomerID])

  function handleClose() {
    setError('')
    setSelectedCustomerID('')
    onClose?.()
  }

  async function handleCreateEnrollmentAndPackage(payload) {
    if (!resolvedCustomerID) {
      setError('Please select a student.')
      return { ok: false }
    }

    setError('')
    setSubmitting(true)

    const enrRes = await api.post('/api/enrollment', {
      customerID: resolvedCustomerID,
      label: payload?.label?.trim() || undefined,
      teacherID: payload?.teacherID || undefined,
    })

    if (!enrRes?.success) {
      setError(enrRes?.error || 'Failed to create enrollment.')
      setSubmitting(false)
      return { ok: false }
    }

    const created =
      enrRes?.data?.enrollment && typeof enrRes.data.enrollment === 'object'
        ? enrRes.data.enrollment
        : enrRes.data
    const enrollmentID = String(created?._id || created?.enrollmentID || '')

    if (!enrollmentID) {
      setError('Enrollment created but ID was not returned.')
      setSubmitting(false)
      return { ok: false }
    }

    const addRes = await api.post('/api/customer-package/add', {
      customerID: resolvedCustomerID,
      packageID: payload.packageID || undefined,
      label: payload?.label?.trim() || undefined,
      expiryDays: payload.expiryDays ? Number(payload.expiryDays) : undefined,
      enrollmentID,
      services: (payload.services || []).map((s) => ({
        serviceCode: s.serviceCode,
        serviceName: s.serviceName,
        color: s.color,
        numberOfSessions: Number(s.numberOfSessions || 0),
        pricePerSession: Number(s.pricePerSession || 0),
        discountType: s.discountType || 'none',
        discountAmount: Number(s.discountAmount || 0),
        finalAmount: Number(s.finalAmount || 0),
      })),
      billingType: payload.billingType,
      billing:
        payload.billingType === 'one_time'
          ? {
              method: payload.billing?.method || 'cash',
              collectDate: payload.billing?.collectDate || undefined,
              ...(payload.billing?.useWallet && Number(payload.billing?.walletAmount) > 0
                ? { walletAmount: Number(payload.billing.walletAmount) }
                : {}),
            }
          : payload.billingType === 'payment_plan'
            ? (() => {
                const totalAmount = (payload.services || []).reduce(
                  (sum, s) => sum + Number(s.finalAmount || 0),
                  0,
                )
                const mode = payload.billing?.installmentMode || 'count'
                const numberOfInstallments =
                  mode === 'amount'
                    ? Math.ceil(totalAmount / Number(payload.billing?.installmentAmount || 1))
                    : Number(payload.billing?.numberOfInstallments || 0)
                return {
                  installmentMode: mode,
                  numberOfInstallments,
                  installmentAmount:
                    mode === 'amount' ? Number(payload.billing?.installmentAmount) : undefined,
                  frequency: payload.billing?.frequency,
                  startDate: payload.billing?.startDate,
                }
              })()
            : payload.billingType === 'flexible'
              ? payload.billing?.scheduleMode === 'custom'
                ? {
                    customInstallments: (payload.billing?.customInstallments || [])
                      .filter((c) => c.dueDate && Number(c.amount) > 0)
                      .map((c) => ({ dueDate: c.dueDate, amount: Number(c.amount) })),
                  }
                : { dueDate: payload.billing?.dueDate || undefined }
              : {},
      ...(payload.purchaseDate ? { purchaseDate: payload.purchaseDate } : {}),
      ...(payload.tip?.teacherID && payload.tip?.amount
        ? {
            tip: {
              teacherID: payload.tip.teacherID,
              amount: Number(payload.tip.amount),
              method: payload.tip.method || 'cash',
            },
          }
        : {}),
    })

    if (!addRes?.success) {
      setError(addRes?.error || 'Failed to add package to enrollment.')
      setSubmitting(false)
      return { ok: false }
    }

    let checkoutUrl = payload.billingType === 'one_time' ? (addRes.data?.checkoutUrl || null) : null

    const collectAmount = Number(payload.billing?.collectAmount || 0)
    const collectNow = Boolean(payload.billing?.collectNow) && collectAmount > 0
    const method = payload.billing?.method || 'cash'

    const isScheduledFlexible =
      payload.billingType === 'flexible' && payload.billing?.scheduleMode === 'custom'

    if (collectNow && (payload.billingType === 'payment_plan' || isScheduledFlexible)) {
      const planRes = await api.get(`/api/payment-plan/customer/${resolvedCustomerID}`)
      const plans = planRes?.success ? planRes.data || [] : []
      const matchesEnrollment = (p) =>
        String(p.enrollmentID?._id ?? p.enrollmentID) === String(enrollmentID)
      const byNewest = (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      const plan =
        plans.filter(matchesEnrollment).sort(byNewest)[0] ?? [...plans].sort(byNewest)[0]
      const firstPending = (plan?.installments || []).findIndex((i) => i.status === 'pending')
      if (plan && firstPending !== -1) {
        const payRes = await api.post(`/api/payment-plan/${plan._id}/pay-installment`, {
          installmentIndex: firstPending,
          method,
          paymentDate: payload.billing?.collectDate || undefined,
        })
        if (!payRes?.success) {
          setError(payRes?.error || 'Enrollment created but first installment payment failed.')
          setSubmitting(false)
          return { ok: false }
        }
        checkoutUrl = payRes.data?.checkoutUrl || null
      }
    } else if (collectNow && payload.billingType === 'flexible' && !isScheduledFlexible) {
      const payRes = await api.post('/api/payment', {
        customerID: resolvedCustomerID,
        enrollmentID,
        type: 'package_purchase',
        amount: collectAmount,
        method,
        paymentDate: payload.billing?.collectDate || undefined,
      })
      if (!payRes?.success) {
        setError(payRes?.error || 'Enrollment created but initial payment failed.')
        setSubmitting(false)
        return { ok: false }
      }
      checkoutUrl = payRes.data?.checkoutUrl || null
    }

    setSubmitting(false)
    handleClose()
    onSuccess?.()
    return { ok: true, checkoutUrl }
  }

  return (
    <Sheet open={open} onClose={handleClose} width={SHEET_WIDTH}>
      <SheetContent onClose={handleClose} className="flex flex-col overflow-hidden p-0">
        <div className="shrink-0 border-b border-border bg-muted/30 px-5 pt-5 pb-3">
          <p className="text-[14px] font-bold text-foreground">
            {mode === 'membership' ? 'Assign Membership' : 'Create Enrollment'}
          </p>
          <p className="text-[12px] text-muted-foreground mt-1">
            {mode === 'membership'
              ? 'Give this student a recurring membership.'
              : mode === 'service'
                ? 'Sell services on their own — enrollment and services in one go.'
                : 'Create enrollment and package in one go.'}
          </p>
          <div className="mt-3 inline-flex rounded-lg border border-border bg-background p-0.5">
            {[
              { v: 'service', label: 'Service' },
              { v: 'package', label: 'Packages' },
              { v: 'membership', label: 'Memberships' },
            ].map((opt) => (
              <button
                key={opt.v}
                type="button"
                onClick={() => { setMode(opt.v); setError('') }}
                className={[
                  'h-8 px-4 rounded-md text-[12px] font-medium transition-colors',
                  mode === opt.v ? 'bg-brand text-brand-foreground' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {mode !== 'membership' ? (
            <>
              <div className="rounded-xl border border-border bg-card p-3 mb-0">
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Student</p>
                {fixedCustomerID ? (
                  <p className="text-[12px] font-medium text-foreground truncate">
                    {selectedCustomerLabel || 'Selected student'}
                  </p>
                ) : (
                  <SearchableSelect
                    value={selectedCustomerID}
                    onChange={(v) => setSelectedCustomerID(v)}
                    options={customerOptions}
                    placeholder="Select student…"
                  />
                )}
              </div>

              <NewEnrollmentPackageInline
                teacherOptions={teacherOptions}
                serviceOnly={mode === 'service'}
                packageTemplates={mode === 'service' ? [] : sellablePackages}
                allowedServiceCodes={allowedServiceCodes}
                customerID={resolvedCustomerID}
                locationID={resolvedLocationID}
                onCancel={handleClose}
                onSubmit={handleCreateEnrollmentAndPackage}
              />

              {error && (
                <div className="mt-3 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-[12px] text-destructive">
                  {error}
                </div>
              )}
              {submitting && (
                <p className="mt-2 text-[11px] text-muted-foreground">Creating…</p>
              )}
            </>
          ) : (
            <>
              {!fixedCustomerID && (
                <div className="rounded-xl border border-border bg-card p-3 mb-4">
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Student</p>
                  <SearchableSelect
                    value={selectedCustomerID}
                    onChange={(v) => setSelectedCustomerID(v)}
                    options={customerOptions}
                    placeholder="Select student…"
                  />
                </div>
              )}
              <AssignMembershipForm
                customerID={resolvedCustomerID}
                locationID={resolvedLocationID}
                onSuccess={() => { handleClose(); onSuccess?.() }}
                onCancel={handleClose}
              />
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
