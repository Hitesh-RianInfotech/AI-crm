'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PhoneCall, Users, UserPlus, AlarmClock, CalendarClock, CalendarCheck2 } from 'lucide-react'
import MainLayout from '@/components/layout/MainLayout'
import { Input } from '@/components/ui/input'
import SearchInput from '@/components/ui/search-input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import LeadsDialog from '@/app/leads/components/LeadsDialog'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import api from '@/lib/api'
import { cn, formatDate } from '@/lib/utils'
import { useLeadStages, formatLeadStageLabel, getLeadStageColor } from '@/lib/lead-stages'
import StatusColorBadge from '@/components/shared/StatusColorBadge'

const ROWS_PER_PAGE = 10

function todayDateStr() {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 10)
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target - today) / (1000 * 60 * 60 * 24))
}

function CallbackBadge({ date }) {
  const diff = daysUntil(date)
  if (diff === null) return <span className="text-sm text-muted-foreground">—</span>
  let style = 'bg-muted text-foreground'
  let label = formatDate(date)
  if (diff < 0) {
    style = 'bg-rose-100 text-rose-800'
    label = `${formatDate(date)} · Overdue`
  } else if (diff === 0) {
    style = 'bg-warning/10 text-warning'
    label = `${formatDate(date)} · Today`
  } else if (diff <= 3) {
    style = 'bg-warning/10 text-warning'
    label = `${formatDate(date)} · in ${diff}d`
  }
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', style)}>
      {label}
    </span>
  )
}

function SummaryCard({ label, value, icon: Icon, accent }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', accent)}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
        <p className="text-xl font-bold text-foreground leading-tight">{value}</p>
      </div>
    </div>
  )
}

export default function CallbackReportPage() {
  const router = useRouter()
  const { stages: stageOptions } = useLeadStages()
  const [tab, setTab] = useState('leads')

  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [stage, setStage] = useState('')
  const [studentStatus, setStudentStatus] = useState('')

  const [locations, setLocations] = useState([])
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [summary, setSummary] = useState({ total: 0, overdue: 0, today: 0, upcoming: 0 })
  const [summaryLoading, setSummaryLoading] = useState(true)

  const [viewLeadId, setViewLeadId] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    api.get('/api/location?limit=200').then((res) => {
      if (res.success) setLocations(res.data || [])
    })
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [tab, debouncedSearch, fromDate, toDate, stage, studentStatus])

  const buildParams = useCallback(
    (conditions, { page = 1, limit = ROWS_PER_PAGE } = {}) => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(limit))
      params.set('sortBy', 'callbackDate')
      params.set('sortOrder', 'asc')
      params.set('conditionLogic', 'AND')
      params.set('conditions', JSON.stringify(conditions))
      if (debouncedSearch) params.set('search', debouncedSearch)
      if (tab === 'leads' && stage) params.set('stage', stage)
      if (tab === 'customers' && studentStatus) params.set('studentStatus', studentStatus)
      return params
    },
    [tab, stage, studentStatus, debouncedSearch],
  )

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const conditions = [{ field: 'callbackDate', operator: 'exists', value: true }]
      if (fromDate) conditions.push({ field: 'callbackDate', operator: 'gte', value: fromDate })
      if (toDate) conditions.push({ field: 'callbackDate', operator: 'lte', value: toDate })

      const params = buildParams(conditions, { page: currentPage })
      const path = tab === 'leads' ? `/api/lead?${params}` : `/api/customer?${params}`
      const result = await api.get(path)
      if (result.success) {
        setRows(result.data || [])
        setTotal(result.pagination?.total ?? 0)
      } else {
        setRows([])
        setTotal(0)
      }
    } finally {
      setLoading(false)
    }
  }, [tab, currentPage, fromDate, toDate, buildParams])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Overview counts (respecting search/stage but not the date-range fields)
  // so the cards read as "where things stand right now" while the table
  // below stays scoped to whatever date range is picked.
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true)
    try {
      const path = tab === 'leads' ? '/api/lead' : '/api/customer'
      const base = [{ field: 'callbackDate', operator: 'exists', value: true }]
      const today = todayDateStr()

      const [totalRes, overdueRes, todayRes, upcomingRes] = await Promise.all([
        api.get(`${path}?${buildParams(base, { limit: 1 })}`),
        api.get(`${path}?${buildParams([...base, { field: 'callbackDate', operator: 'lt', value: today }], { limit: 1 })}`),
        api.get(
          `${path}?${buildParams(
            [...base, { field: 'callbackDate', operator: 'between', value: [today, today] }],
            { limit: 1 },
          )}`,
        ),
        api.get(`${path}?${buildParams([...base, { field: 'callbackDate', operator: 'gt', value: today }], { limit: 1 })}`),
      ])

      setSummary({
        total: totalRes.pagination?.total ?? 0,
        overdue: overdueRes.pagination?.total ?? 0,
        today: todayRes.pagination?.total ?? 0,
        upcoming: upcomingRes.pagination?.total ?? 0,
      })
    } finally {
      setSummaryLoading(false)
    }
  }, [tab, buildParams])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  const totalPages = Math.max(1, Math.ceil(total / ROWS_PER_PAGE))

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

  const clearFilters = () => {
    setSearch('')
    setFromDate('')
    setToDate('')
    setStage('')
    setStudentStatus('')
  }

  const hasActiveFilters = Boolean(search || fromDate || toDate || stage || studentStatus)
  const colCount = tab === 'leads' ? 5 : 4

  return (
    <MainLayout title="Callback Report" subtitle="Leads and customers with an upcoming or overdue callback date">
      <div className="space-y-5 py-2">
        <div className="inline-flex items-center rounded-lg border border-border bg-card p-1">
          <button
            type="button"
            onClick={() => {
              setTab('leads')
              setStudentStatus('')
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === 'leads' ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <UserPlus className="h-3.5 w-3.5" />
            Leads
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('customers')
              setStage('')
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === 'customers' ? 'bg-brand text-white' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Users className="h-3.5 w-3.5" />
            Customers
          </button>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="With a callback"
            value={summaryLoading ? '—' : summary.total}
            icon={PhoneCall}
            accent="bg-muted text-foreground"
          />
          <SummaryCard
            label="Overdue"
            value={summaryLoading ? '—' : summary.overdue}
            icon={AlarmClock}
            accent="bg-rose-100 text-rose-700"
          />
          <SummaryCard
            label="Due today"
            value={summaryLoading ? '—' : summary.today}
            icon={CalendarClock}
            accent="bg-warning/10 text-warning"
          />
          <SummaryCard
            label="Upcoming"
            value={summaryLoading ? '—' : summary.upcoming}
            icon={CalendarCheck2}
            accent="bg-success/10 text-success"
          />
        </section>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-full max-w-xs">
              <label className="block text-xs font-medium text-muted-foreground mb-1">Search</label>
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'leads' ? 'Search leads…' : 'Search customers…'}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Callback from</label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-9 text-[13px]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Callback to</label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-9 text-[13px]"
              />
            </div>
            {tab === 'leads' && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Stage</label>
                <select
                  value={stage}
                  onChange={(e) => setStage(e.target.value)}
                  className="h-9 px-3 text-[13px] border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-info"
                >
                  <option value="">All stages</option>
                  {stageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {tab === 'customers' && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Student status</label>
                <select
                  value={studentStatus}
                  onChange={(e) => setStudentStatus(e.target.value)}
                  className="h-9 px-3 text-[13px] border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-info"
                >
                  <option value="">All students</option>
                  <option value="Active">Active</option>
                  <option value="Inactive">Inactive</option>
                </select>
              </div>
            )}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-9 px-3 text-[13px] font-medium text-muted-foreground hover:text-foreground"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border bg-muted/40">
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Name</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Contact</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Location</TableHead>
                {tab === 'leads' && (
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Stage</TableHead>
                )}
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Callback Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="py-16 text-center">
                    <LoadingSpinner />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colCount} className="py-16 text-center text-sm text-muted-foreground">
                    <PhoneCall className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                    No {tab} with a callback date match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow
                    key={row._id}
                    className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer last:border-0"
                    onClick={() =>
                      tab === 'leads'
                        ? setViewLeadId(row._id)
                        : router.push(`/settings/users-roles/customers/${row._id}`)
                    }
                  >
                    <TableCell className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground shrink-0">
                          {row.name?.charAt(0) || '?'}
                        </div>
                        <p className="text-sm font-normal text-foreground leading-tight">{row.name}</p>
                      </div>
                    </TableCell>
                    <TableCell className="py-3 px-4">
                      <div className="text-sm font-normal text-foreground leading-tight">{row.email}</div>
                      <div className="text-xs font-normal text-muted-foreground leading-tight">{row.phoneNumber}</div>
                    </TableCell>
                    <TableCell className="py-3 px-4 text-sm text-muted-foreground">
                      {tab === 'leads' ? row.location || '—' : locationName(row.locationID)}
                    </TableCell>
                    {tab === 'leads' && (
                      <TableCell className="py-3 px-4">
                        <StatusColorBadge
                          color={getLeadStageColor(row.stage, stageOptions)}
                          className="px-2.5 py-0.5 text-xs font-medium"
                        >
                          {formatLeadStageLabel(row.stage, stageOptions) || 'New'}
                        </StatusColorBadge>
                      </TableCell>
                    )}
                    <TableCell className="py-3 px-4">
                      <CallbackBadge date={row.callbackDate} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1 || loading}
              className="inline-flex items-center h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages} · {total} total
            </span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || loading}
              className="inline-flex items-center h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <LeadsDialog
        open={Boolean(viewLeadId)}
        onClose={() => setViewLeadId(null)}
        leads={rows}
        onRefresh={fetchRows}
        initialLeadId={viewLeadId}
        viewOnly
      />
    </MainLayout>
  )
}
