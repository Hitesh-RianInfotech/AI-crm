'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, MoreHorizontal, Trash2, Pencil, ChevronDown, ExternalLink, SlidersHorizontal, X, Users, MapPin, Wallet, ListPlus } from 'lucide-react'
import MainLayout from '@/components/layout/MainLayout'
import SearchInput from '@/components/ui/search-input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import CustomersFilterPanel from '@/components/customers/CustomersFilterPanel'
import DynamicListFormDialog from '@/components/dynamic-list/DynamicListFormDialog'
import DynamicListMemberSendDialog from '@/components/dynamic-list/DynamicListMemberSendDialog'
import BulkSendActionBar from '@/components/shared/BulkSendActionBar'
import { RowsPerPage } from '@/components/shared/RowsPerPage'
import {
  EMPTY_CUSTOMER_FILTERS,
  sanitizeCustomerFilters,
  hasActiveCustomerFilters,
  countAdvancedCustomerFilters,
} from '@/lib/customer-page-filters'
import { buildCustomerQueryParams, filtersToConditionsForForm } from '@/lib/customer-filter-fields'
import {
  getActiveCustomerFilterChips,
  removeCustomerFilterChip,
  syncCustomerSpendRanking,
} from '@/lib/customer-active-filter-chips'
import CustomerActiveFiltersBar from '@/components/customers/CustomerActiveFiltersBar'
import { formatReasonLabel, normalizeConditionsForForm } from '@/lib/dynamic-list-normalize'
import { extractLeadReasonsList } from '@/lib/workflow-normalize'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import LocationSelector from '@/components/shared/LocationSelector'
import CustomerMigrationImportDialog from '@/components/customers/CustomerMigrationImportDialog'
import { getInitials, formatDate, cn } from '@/lib/utils'
import { isViewingAllBranches, getBranchQueryParam } from '@/lib/branch-filter'
import { hasPermission } from '@/lib/permissions'
import {
  customerLifecycleBadgeClass,
  customerLifecycleLabel,
  CUSTOMER_LIFECYCLE_STATUS_OPTIONS,
} from '@/lib/customer-lifecycle'

const CUSTOMER_CSV_FIELDS = [
  { key: 'name', header: 'name', sample: 'Jane Smith' },
  { key: 'email', header: 'email', sample: 'jane.smith@example.com' },
  { key: 'phoneNumber', header: 'phonenumber', sample: '+1234567890' },
  { key: 'dateOfBirth', header: 'dateofbirth', sample: '1990-01-01' },
  { key: 'gender', header: 'gender', sample: 'female' },
  { key: 'street', header: 'street', sample: '123 Main St' },
  { key: 'city', header: 'city', sample: 'New York' },
  { key: 'state', header: 'state', sample: 'NY' },
  { key: 'zipCode', header: 'zipcode', sample: '10001' },
  { key: 'country', header: 'country', sample: 'USA' },
  { key: 'credits', header: 'credits', sample: '10' },
  { key: 'joinedDate', header: 'joineddate', sample: '2026-01-01' },
]

const EMPTY_FORM = {
  name: '',
  email: '',
  phoneNumber: '',
  credits: 0,
  locationID: [],
  dateOfBirth: '',
  gender: '',
  callbackDate: '',
  lifecycleStatus: 'active',
  address: {
    street: '',
    city: '',
    state: '',
    zipCode: '',
    country: 'USA',
  },
}

const GENDER_OPTIONS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
]

const inputClass =
  'h-9 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15'

function FormField({ label, required, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[12px] font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

function FormSection({ icon: Icon, title, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-foreground">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function CustomerFormDialog({ open, onClose, onSaved, initial }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const toast = useToast()
  const isEdit = Boolean(initial?._id)

  useEffect(() => {
    if (open) {
      setForm(initial
        ? {
            name: initial.name || '',
            email: initial.email || '',
            phoneNumber: initial.phoneNumber || '',
            credits: initial.credits ?? 0,
            locationID: Array.isArray(initial.locationID)
              ? initial.locationID.map((l) => String(l?._id ?? l)).filter(Boolean)
              : initial.locationID
                ? [String(initial.locationID?._id ?? initial.locationID)]
                : [],
            dateOfBirth: initial.dateOfBirth ? String(initial.dateOfBirth).slice(0, 10) : '',
            gender: initial.gender || '',
            callbackDate: initial.callbackDate ? String(initial.callbackDate).slice(0, 10) : '',
            lifecycleStatus: initial.lifecycleStatus || 'active',
            address: {
              street: initial.address?.street || '',
              city: initial.address?.city || '',
              state: initial.address?.state || '',
              zipCode: initial.address?.zipCode || '',
              country: initial.address?.country || 'USA',
            },
          }
        : EMPTY_FORM
      )
      setError(null)
    }
  }, [open, initial])

  // Clear any error from a previous failed submission as soon as the user
  // edits the form again — otherwise a stale "email already exists" (or any
  // other) message stays on screen after they've already changed the field
  // it was complaining about, making it look like the *new* value is the
  // problem.
  const setField = (key, val) => {
    setError(null)
    setForm((prev) => ({ ...prev, [key]: val }))
  }
  const setAddressField = (key, val) => {
    setError(null)
    setForm((prev) => ({ ...prev, address: { ...prev.address, [key]: val } }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim() || !form.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (!Array.isArray(form.locationID) || form.locationID.length === 0) {
      setError('Please select at least one location.')
      return
    }
    setSaving(true)
    const address = {
      street: form.address.street.trim(),
      city: form.address.city.trim(),
      state: form.address.state.trim(),
      zipCode: form.address.zipCode.trim(),
      country: form.address.country.trim() || 'USA',
    }
    const hasAddress = address.street || address.city || address.state || address.zipCode

    const payload = {
      name: form.name.trim(),
      email: form.email.trim(),
      phoneNumber: form.phoneNumber.trim() || undefined,
      credits: Number(form.credits) || 0,
      locationID: form.locationID,
      dateOfBirth: form.dateOfBirth || undefined,
      gender: form.gender || undefined,
      callbackDate: form.callbackDate || (isEdit ? null : undefined),
      lifecycleStatus: form.lifecycleStatus || 'active',
      address: hasAddress ? address : undefined,
    }
    const result = isEdit
      ? await api.put(`/api/customer/${initial._id}`, payload)
      : await api.post('/api/customer', payload)

    if (result.success) {
      toast.success(isEdit ? 'Customer updated.' : 'Customer created.')
      onSaved()
      onClose()
    } else {
      setError(result.error || 'Something went wrong.')
    }
    setSaving(false)
  }

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="2xl">
      <DialogContent onClose={saving ? undefined : onClose} className="max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{isEdit ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            <FormSection icon={Users} title="Basic information">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Name" required>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="Full name"
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Email" required>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                    placeholder="email@example.com"
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Phone">
                  <input
                    type="tel"
                    value={form.phoneNumber}
                    onChange={(e) => setField('phoneNumber', e.target.value)}
                    placeholder="+1 555 000 0000"
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Date of birth">
                  <input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setField('dateOfBirth', e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Gender">
                  <div className="relative">
                    <select
                      value={form.gender}
                      onChange={(e) => setField('gender', e.target.value)}
                      className={cn(inputClass, 'appearance-none pr-8')}
                    >
                      <option value="">Select…</option>
                      {GENDER_OPTIONS.map((g) => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </FormField>
                <FormField label="Callback date">
                  <input
                    type="date"
                    value={form.callbackDate}
                    onChange={(e) => setField('callbackDate', e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Lifecycle status">
                  <div className="relative">
                    <select
                      value={form.lifecycleStatus || 'active'}
                      onChange={(e) => setField('lifecycleStatus', e.target.value)}
                      className={cn(inputClass, 'appearance-none pr-8')}
                    >
                      {CUSTOMER_LIFECYCLE_STATUS_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  </div>
                </FormField>
              </div>
            </FormSection>

            <FormSection icon={MapPin} title="Location">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Studio location" required>
                  <LocationSelector
                    value={form.locationID}
                    onChange={(ids) => setField('locationID', ids)}
                    multiple
                    showAllOption={false}
                    placeholder="Select location(s)…"
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Street">
                  <input
                    type="text"
                    value={form.address.street}
                    onChange={(e) => setAddressField('street', e.target.value)}
                    placeholder="123 Main St"
                    className={inputClass}
                  />
                </FormField>
                <FormField label="City">
                  <input
                    type="text"
                    value={form.address.city}
                    onChange={(e) => setAddressField('city', e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="State">
                  <input
                    type="text"
                    value={form.address.state}
                    onChange={(e) => setAddressField('state', e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Zip code">
                  <input
                    type="text"
                    value={form.address.zipCode}
                    onChange={(e) => setAddressField('zipCode', e.target.value)}
                    className={inputClass}
                  />
                </FormField>
                <FormField label="Country">
                  <input
                    type="text"
                    value={form.address.country}
                    onChange={(e) => setAddressField('country', e.target.value)}
                    className={inputClass}
                  />
                </FormField>
              </div>
            </FormSection>

            <FormSection icon={Wallet} title="Billing">
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Credits">
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
                    <input
                      type="number"
                      min="0"
                      value={form.credits}
                      onChange={(e) => setField('credits', e.target.value)}
                      className={cn(inputClass, 'pl-6')}
                    />
                  </div>
                </FormField>
              </div>
            </FormSection>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border bg-muted/20 px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add customer'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function CustomersPage() {
  const router = useRouter()
  const canWriteCustomers = hasPermission('customers', 'manage', 'write')
  const canDeleteCustomers = hasPermission('customers', 'manage', 'delete')
  const [customers, setCustomers] = useState([])
  const [locations, setLocations] = useState([])
  const [teachers, setTeachers] = useState([])
  const [memberships, setMemberships] = useState([])
  const [packages, setPackages] = useState([])
  const [tagOptions, setTagOptions] = useState([])
  const [leadReasons, setLeadReasons] = useState([])
  const [teacherFilter, setTeacherFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const [filterPanelOpen, setFilterPanelOpen] = useState(false)
  const [filters, setFilters] = useState(EMPTY_CUSTOMER_FILTERS)
  const [listDialogOpen, setListDialogOpen] = useState(false)
  const [prefillList, setPrefillList] = useState(null)

  const [selectedIds, setSelectedIds] = useState([])
  const [selectedCustomersData, setSelectedCustomersData] = useState([])
  const [selectingAll, setSelectingAll] = useState(false)
  const [sendDialogOpen, setSendDialogOpen] = useState(false)
  const [sendChannel, setSendChannel] = useState('SMS')

  const toast = useToast()

  const isFiltered = hasActiveCustomerFilters({
    ...filters,
    search: debouncedSearch,
    teacherID: teacherFilter,
  })
  const showTotalSpend = filters?.sortBy === 'payment.totalSpend'
  const activeFilterChips = useMemo(
    () =>
      getActiveCustomerFilterChips(
        { ...filters, teacherID: teacherFilter },
        {
          teachers,
          locations,
          tags: tagOptions,
          memberships,
          packages,
          leadReasons,
          search: debouncedSearch,
        },
      ),
    [
      filters,
      teacherFilter,
      teachers,
      locations,
      tagOptions,
      memberships,
      packages,
      leadReasons,
      debouncedSearch,
    ],
  )

  const formatTotalSpend = (customer) => {
    const raw = customer?.payment?.totalSpend
    if (raw == null || raw === '') return '—'
    const n = Number(raw)
    if (!Number.isFinite(n)) return '—'
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
  }

  const pageCustomerIds = useMemo(() => customers.map((c) => c._id).filter(Boolean), [customers])
  const allOnPageSelected =
    pageCustomerIds.length > 0 && pageCustomerIds.every((id) => selectedIds.includes(id))
  const selectedCustomers = selectedCustomersData

  const clearSelection = () => {
    setSelectedIds([])
    setSelectedCustomersData([])
  }

  const toRecipientCustomer = (customer) => {
    if (!customer?._id) return null
    return {
      _id: customer._id,
      name: customer.name,
      email: customer.email,
      phoneNumber: customer.phoneNumber,
      locationID: customer.locationID,
      type: 'Customer',
    }
  }

  useEffect(() => {
    api.get('/api/location?limit=200').then((res) => {
      if (res.success) setLocations(res.data || [])
    })
    api.get('/api/teacher?limit=200&status=active').then((res) => {
      if (res.success) setTeachers(res.data || [])
    })
    api.get('/api/membership?limit=200').then((res) => {
      if (res.success) setMemberships(res.data || [])
    })
    api.get('/api/package?limit=200').then((res) => {
      if (res.success) setPackages(res.data || [])
    })
    api.get('/api/customer/tags').then((res) => {
      if (res.success) setTagOptions(res.data || [])
    })
    api.get('/api/lead-reasons').then((res) => {
      if (res?.success) setLeadReasons(extractLeadReasonsList(res))
    })
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    clearSelection()
    setCurrentPage(1)
  }, [debouncedSearch, teacherFilter, filters, pageSize])

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    const sanitized = sanitizeCustomerFilters({ ...filters, search: debouncedSearch, teacherID: teacherFilter })
    const params = buildCustomerQueryParams({ page: currentPage, limit: pageSize, filters: sanitized })
    const result = await api.get(`/api/customer?${params}`)
    if (result.success) {
      setCustomers(Array.isArray(result.data) ? result.data : [])
      const t = result.pagination?.total ?? result.total ?? 0
      setTotal(t)
      setTotalPages(Math.max(1, Math.ceil(t / pageSize)))
    }
    setLoading(false)
  }, [currentPage, debouncedSearch, teacherFilter, filters, pageSize])

  useEffect(() => { fetchCustomers() }, [fetchCustomers])

  const toggleOne = (customer) => {
    if (!customer?._id) return
    const isSelected = selectedIds.includes(customer._id)
    if (isSelected) {
      setSelectedIds((prev) => prev.filter((id) => id !== customer._id))
      setSelectedCustomersData((prev) => prev.filter((item) => item._id !== customer._id))
      return
    }
    const recipient = toRecipientCustomer(customer)
    setSelectedIds((prev) => [...prev, customer._id])
    setSelectedCustomersData((prev) => [...prev.filter((item) => item._id !== customer._id), recipient])
  }

  const toggleAllOnPage = () => {
    if (allOnPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !pageCustomerIds.includes(id)))
      setSelectedCustomersData((prev) => prev.filter((c) => !pageCustomerIds.includes(c._id)))
      return
    }
    const toAdd = customers
      .map(toRecipientCustomer)
      .filter(Boolean)
      .filter((c) => !selectedIds.includes(c._id))
    setSelectedIds((prev) => [...new Set([...prev, ...toAdd.map((c) => c._id)])])
    setSelectedCustomersData((prev) => {
      const existingIds = new Set(prev.map((c) => c._id))
      return [...prev, ...toAdd.filter((c) => !existingIds.has(c._id))]
    })
  }

  const selectAllMatching = async () => {
    if (selectingAll || total <= customers.length) return
    setSelectingAll(true)
    try {
      const sanitized = sanitizeCustomerFilters({ ...filters, search: debouncedSearch, teacherID: teacherFilter })
      const params = buildCustomerQueryParams({ page: 1, limit: total, filters: sanitized })
      const result = await api.get(`/api/customer?${params}`)
      if (!result.success) {
        toast.error(result.error || 'Could not load all customers.')
        return
      }
      const data = Array.isArray(result.data) ? result.data : []
      const allCustomers = data.map(toRecipientCustomer).filter(Boolean)
      setSelectedIds(allCustomers.map((c) => c._id))
      setSelectedCustomersData(allCustomers)
    } catch (e) {
      console.error(e)
      toast.error('Could not select all customers.')
    } finally {
      setSelectingAll(false)
    }
  }

  const openSendDialog = (channel) => {
    if (!selectedCustomers.length) return
    setSendChannel(channel)
    setSendDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const result = await api.delete(`/api/customer/${deleteTarget._id}`)
    if (result.success) {
      toast.success('Customer deleted.')
      setSelectedIds((prev) => prev.filter((id) => id !== deleteTarget._id))
      setSelectedCustomersData((prev) => prev.filter((item) => item._id !== deleteTarget._id))
      setDeleteTarget(null)
      fetchCustomers()
    } else {
      toast.error(result.error || 'Failed to delete customer.')
    }
    setDeleting(false)
  }

  const handleBulkDeleteCustomers = async () => {
    if (!canDeleteCustomers || selectedIds.length === 0) return
    const confirmed = window.confirm(
      `Delete ${selectedIds.length} customer${selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`,
    )
    if (!confirmed) return

    setBulkDeleting(true)
    try {
      const result = await api.request('/api/customer/bulk', {
        method: 'DELETE',
        body: JSON.stringify({ ids: selectedIds }),
      })
      if (result.success) {
        const count = result.data?.deletedCount ?? selectedIds.length
        toast.success(`${count} customer${count === 1 ? '' : 's'} deleted.`)
        clearSelection()
        fetchCustomers()
      } else {
        toast.error(result.error || 'Failed to delete selected customers.')
      }
    } catch (e) {
      console.error(e)
      toast.error('Unexpected error while deleting selected customers.')
    } finally {
      setBulkDeleting(false)
    }
  }

  const locationName = (raw) => {
    const ids = Array.isArray(raw)
      ? raw.map((l) => String(l?._id ?? l)).filter(Boolean)
      : raw
        ? [String(raw?._id ?? raw)]
        : []
    if (!ids.length) return '—'
    const names = ids.map((id) => locations.find((l) => String(l._id) === id)?.name).filter(Boolean)
    if (!names.length) return '—'
    if (names.length <= 2) return names.join(', ')
    return `${names.slice(0, 2).join(', ')} +${names.length - 2}`
  }

  const openCreateListFromFilters = () => {
    const sanitized = sanitizeCustomerFilters({ ...filters, search: debouncedSearch, teacherID: teacherFilter })
    const conditions = filtersToConditionsForForm(sanitized)
    if (conditions.length === 0 && !sanitized.search) {
      toast.info('No filters applied', { description: 'Apply at least one filter before saving as a list.' })
      return
    }
    setPrefillList({
      name: '',
      description: '',
      entityType: 'customer',
      conditionLogic: sanitized.conditionLogic || 'AND',
      conditions: normalizeConditionsForForm(conditions),
      groupLogics: sanitized.groupLogics || {},
      status: 'active',
    })
    setListDialogOpen(true)
  }

  const handleExportCustomers = async () => {
    const sanitized = sanitizeCustomerFilters({ ...filters, search: debouncedSearch, teacherID: teacherFilter })
    const params = buildCustomerQueryParams({ page: 1, limit: total || 1000, filters: sanitized })
    const result = await api.get(`/api/customer?${params}`)
    if (!result.success) {
      throw new Error(result.error || 'Failed to load customers for export')
    }
    const data = Array.isArray(result.data) ? result.data : []
    return data.map((c) => ({
      name: c.name || '',
      email: c.email || '',
      phoneNumber: c.phoneNumber || '',
      dateOfBirth: c.dateOfBirth ? String(c.dateOfBirth).slice(0, 10) : '',
      gender: c.gender || '',
      street: c.address?.street || '',
      city: c.address?.city || '',
      state: c.address?.state || '',
      zipCode: c.address?.zipCode || '',
      country: c.address?.country || '',
      credits: c.credits ?? 0,
      joinedDate: c.createdAt ? String(c.createdAt).slice(0, 10) : '',
    }))
  }

  const handleImportCustomers = async (rows) => {
    const branchId = getBranchQueryParam()
    let successCount = 0
    let errorCount = 0
    let firstError = null
    for (const row of rows) {
      const payload = {
        name: row.name,
        locationID: branchId ? [branchId] : undefined,
        email: row.email,
        phoneNumber: row.phoneNumber,
        dateOfBirth: row.dateOfBirth || undefined,
        gender: row.gender || undefined,
        credits: row.credits ? Number(row.credits) || 0 : 0,
        address: {
          street: row.street || '',
          city: row.city || '',
          state: row.state || '',
          zipCode: row.zipCode || '',
          country: row.country || '',
        },
      }
      const result = await api.post('/api/customer', payload)
      if (result.success) {
        successCount += 1
      } else {
        errorCount += 1
        if (!firstError) firstError = result.error || 'Unknown error'
      }
    }
    if (successCount > 0) fetchCustomers()
    return { successCount, errorCount, errorMessage: firstError }
  }

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground">Customers</h1>
            <p className="mt-0.5 text-[13px] text-muted-foreground">Manage your studio's students and clients</p>
          </div>
          <div className="flex items-center gap-2">
            <CustomerMigrationImportDialog
              quickImportFields={CUSTOMER_CSV_FIELDS}
              onQuickImportRows={canWriteCustomers ? handleImportCustomers : undefined}
              getExportRows={handleExportCustomers}
              disabled={isViewingAllBranches() || !canWriteCustomers}
              disabledReason={
                !canWriteCustomers
                  ? "You don't have permission to import customers"
                  : 'Select a specific branch to import or export customers'
              }
            />
            {canWriteCustomers && (
              <Button onClick={() => { setEditingCustomer(null); setDialogOpen(true) }}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add Customer
              </Button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-3">
          <SearchInput
            className="flex-1 max-w-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers…"
          />
          <div className="relative">
            <select
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              className="h-9 appearance-none rounded-lg border border-border bg-background pl-3 pr-8 text-[13px] text-foreground outline-none focus:border-primary"
            >
              <option value="">All teachers</option>
              {teachers.map((t) => (
                <option key={t._id} value={t._id}>{t.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setFilterPanelOpen(true)}>
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            Filters
            {countAdvancedCustomerFilters(filters) > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--studio-primary)] px-1 text-[10px] font-bold text-white">
                {countAdvancedCustomerFilters(filters)}
              </span>
            )}
          </Button>
          {hasActiveCustomerFilters({ ...filters, search: debouncedSearch, teacherID: teacherFilter }) && (
            <Button variant="outline" size="sm" className="h-9" onClick={openCreateListFromFilters}>
              <ListPlus className="mr-1.5 h-3.5 w-3.5" />
              Save as list
            </Button>
          )}
          {(hasActiveCustomerFilters({ ...filters, search: debouncedSearch, teacherID: teacherFilter }) ||
            debouncedSearch ||
            teacherFilter) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                clearSelection()
                setSearch('')
                setDebouncedSearch('')
                setTeacherFilter('')
                setFilters(EMPTY_CUSTOMER_FILTERS)
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        {activeFilterChips.length > 0 ? (
          <CustomerActiveFiltersBar
            chips={activeFilterChips}
            onRemoveChip={(chip) => {
              clearSelection()
              const next = removeCustomerFilterChip(
                { ...filters, teacherID: teacherFilter, search: debouncedSearch },
                chip,
                {
                  clearSearch: () => {
                    setSearch('')
                    setDebouncedSearch('')
                  },
                },
              )
              setTeacherFilter(next.teacherID || '')
              if (chip?.remove?.type === 'search') {
                setSearch('')
                setDebouncedSearch('')
              }
              setFilters(
                sanitizeCustomerFilters({
                  ...next,
                  teacherID: '',
                  // Keep search in local state; filters.search is not the source of truth
                  search: '',
                }),
              )
            }}
            onClearAll={() => {
              clearSelection()
              setSearch('')
              setDebouncedSearch('')
              setTeacherFilter('')
              setFilters(EMPTY_CUSTOMER_FILTERS)
            }}
          />
        ) : null}

        <CustomersFilterPanel
          open={filterPanelOpen}
          appliedFilters={filters}
          onClose={() => setFilterPanelOpen(false)}
          onApply={(next) => {
            clearSelection()
            setFilters(sanitizeCustomerFilters(syncCustomerSpendRanking(next)))
            setFilterPanelOpen(false)
          }}
          locations={locations}
          teachers={teachers}
          tags={tagOptions}
          memberships={memberships}
          packages={packages}
          leadReasons={leadReasons}
        />

        <DynamicListFormDialog
          open={listDialogOpen}
          onClose={() => {
            setListDialogOpen(false)
            setPrefillList(null)
          }}
          list={prefillList}
          entityType="customer"
          onSaved={() => toast.success('Customer list created')}
        />

        <BulkSendActionBar
          selectedCount={selectedCustomers.length}
          entityLabel="customer"
          onSendSms={() => openSendDialog('SMS')}
          onSendEmail={() => openSendDialog('Email')}
          onClear={clearSelection}
          canDelete={canDeleteCustomers}
          onDelete={handleBulkDeleteCustomers}
          deleting={bulkDeleting}
          showSelectAll={allOnPageSelected}
          selectAllTotal={total}
          pageCount={customers.length}
          onSelectAll={selectAllMatching}
          selectingAll={selectingAll}
        />

        {/* Table */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="w-12">
                  <Checkbox
                    checked={allOnPageSelected}
                    onClick={toggleAllOnPage}
                    disabled={customers.length === 0}
                    className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand"
                  />
                </TableHead>
                <TableHead className="text-[12px] font-semibold">Customer</TableHead>
                <TableHead className="text-[12px] font-semibold">Status</TableHead>
                <TableHead className="text-[12px] font-semibold">Reason</TableHead>
                <TableHead className="text-[12px] font-semibold">Contact</TableHead>
                <TableHead className="text-[12px] font-semibold">Location</TableHead>
                <TableHead className="text-[12px] font-semibold">Credits</TableHead>
                {showTotalSpend ? (
                  <TableHead className="text-[12px] font-semibold">Total spend</TableHead>
                ) : null}
                <TableHead className="text-[12px] font-semibold">Joined</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={showTotalSpend ? 10 : 9} className="py-12 text-center">
                    <LoadingSpinner />
                  </TableCell>
                </TableRow>
              ) : customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showTotalSpend ? 10 : 9} className="py-14 text-center">
                    <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                        <Users className="h-5 w-5 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[13px] font-medium text-foreground">
                          {isFiltered ? 'No customers match this view' : 'No customers yet'}
                        </p>
                        <p className="text-[12px] text-muted-foreground">
                          {isFiltered
                            ? 'Try a different search term or clear your filters.'
                            : "Add your studio's first customer to get started."}
                        </p>
                      </div>
                      {!isFiltered && (
                        <Button size="sm" className="mt-1" onClick={() => { setEditingCustomer(null); setDialogOpen(true) }}>
                          <Plus className="mr-1.5 h-3.5 w-3.5" />
                          Add customer
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((customer) => (
                  <TableRow
                    key={customer._id}
                    className="hover:bg-muted/20 cursor-pointer"
                    onClick={() => router.push(`/settings/users-roles/customers/${customer._id}`)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.includes(customer._id)}
                        onClick={() => toggleOne(customer)}
                        className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-[11px] font-semibold bg-primary/10 text-primary">
                            {getInitials(customer.name)}
                          </AvatarFallback>
                        </Avatar>
                        <p className="text-[13px] font-medium text-foreground">{customer.name}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                          customerLifecycleBadgeClass(customer.lifecycleStatus)
                        )}
                      >
                        {customerLifecycleLabel(customer.lifecycleStatus)}
                      </span>
                    </TableCell>
                    <TableCell className="text-[12px] text-foreground">
                      {customer.reason ? formatReasonLabel(customer.reason, leadReasons) : '—'}
                    </TableCell>
                    <TableCell>
                      <p className="text-[12px] text-foreground">{customer.email}</p>
                      {customer.phoneNumber && (
                        <p className="text-[11px] text-muted-foreground">{customer.phoneNumber}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-[12px] text-muted-foreground">
                      {locationName(customer.locationID)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                        ${Number(customer.prepaidBalance ?? customer.credits ?? 0).toFixed(2)}
                      </span>
                    </TableCell>
                    {showTotalSpend ? (
                      <TableCell className="text-[12px] font-medium text-foreground">
                        {formatTotalSpend(customer)}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-[12px] text-muted-foreground">
                      {formatDate(customer.createdAt)}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/settings/users-roles/customers/${customer._id}`)}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" />
                            View Profile
                          </DropdownMenuItem>
                          {canWriteCustomers && (
                            <DropdownMenuItem onClick={() => { setEditingCustomer(customer); setDialogOpen(true) }}>
                              <Pencil className="mr-2 h-3.5 w-3.5" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          {canDeleteCustomers && (
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget(customer)}
                            >
                              <Trash2 className="mr-2 h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {total > 10 && (
          <div className="flex items-center justify-between text-[12px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>{total} customer{total !== 1 ? 's' : ''}</span>
              <RowsPerPage value={pageSize} onChange={setPageSize} disabled={loading} />
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((p) => p - 1)} className="h-7 px-2.5 text-[12px]">
                  Previous
                </Button>
                <span className="px-2">Page {currentPage} of {totalPages}</span>
                <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage((p) => p + 1)} className="h-7 px-2.5 text-[12px]">
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Dialog */}
      <CustomerFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSaved={fetchCustomers}
        initial={editingCustomer}
      />

      {/* Delete Confirm */}
      <Dialog open={Boolean(deleteTarget)} onClose={deleting ? undefined : () => setDeleteTarget(null)} maxWidth="sm">
        <DialogContent onClose={deleting ? undefined : () => setDeleteTarget(null)}>
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground mt-1">
            Are you sure you want to delete <span className="font-semibold text-foreground">{deleteTarget?.name}</span>? This cannot be undone.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DynamicListMemberSendDialog
        open={sendDialogOpen}
        onClose={() => setSendDialogOpen(false)}
        leads={selectedCustomers}
        initialChannel={sendChannel}
        entityLabel="customer"
        recipientType="Customer"
        onSent={clearSelection}
      />
    </MainLayout>
  )
}
