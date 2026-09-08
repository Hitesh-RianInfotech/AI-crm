'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { Plus, MoreHorizontal, FileText, GripVertical } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import MainLayout from '@/components/layout/MainLayout'
import SearchInput from '@/components/ui/search-input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import api from '@/lib/api'
import { toast } from '@/components/ui/toast'
import GlobalLoader from '@/components/shared/GlobalLoader'
import ServiceDialog from '@/app/calendar/services/components/ServiceDialog'
import LessonDialog from '@/app/calendar/lessons/components/LessonDialog'
import ToDoDialog from '@/app/calendar/todos/components/ToDoDialog'
import {
  ProductsTab, EventTypesTab, SavedTemplatesTab, CreateEventPurchaseDialog,
} from './components/EventsPurchases'

const ROWS_PER_PAGE = 50

// Fetch a package/membership and POST a copy of it, then open the copy's editor.
async function duplicateCatalogEntity(kind, id, router) {
  const isPkg = kind === 'package'
  const base = isPkg ? '/api/package' : '/api/membership'
  const nameKey = isPkg ? 'packageName' : 'membershipName'
  const src = await api.get(`${base}/${id}`)
  if (!src.success) { toast.error('Duplicate failed', { description: src.error }); return }
  const s = src.data
  const common = {
    [nameKey]: `${s[nameKey]} (Copy)`,
    description: s.description,
    sortOrder: s.sortOrder,
    color: s.color,
    isActive: s.isActive,
    locationID: (s.locationID || []).map((l) => l?._id ?? l).filter(Boolean),
    services: (s.services || []).map(({ _id, isChargeable, ...rest }) => rest),
  }
  const payload = isPkg
    ? { ...common, totalDays: s.totalDays, curriculumID: s.curriculumID?._id ?? s.curriculumID ?? undefined }
    : { ...common, durationDays: s.durationDays, price: s.price, autoRenew: s.autoRenew }
  const created = await api.post(base, payload)
  if (!created.success) { toast.error('Duplicate failed', { description: created.error }); return }
  toast.success(`${isPkg ? 'Package' : 'Membership'} duplicated`)
  router.push(`/calendar/${isPkg ? 'packages' : 'memberships'}/${created.data._id}`)
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// Shared table footer: Previous / rows-per-page selector + page counter / Next.
function PaginationBar({ currentPage, totalPages, loading, pageSize, setPageSize, setCurrentPage }) {
  const btn = 'inline-flex items-center h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed'
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-border">
      <button type="button" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1 || loading} className={btn}>Previous</button>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          Rows
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1) }}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
      </div>
      <button type="button" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || loading} className={btn}>Next</button>
    </div>
  )
}

const SCHEDULED_TABS = [
  { id: 'services', label: 'Services', hint: 'Calendar-based offerings' },
  { id: 'packages', label: 'Packages', hint: 'Bundles of services' },
  { id: 'memberships', label: 'Memberships', hint: 'Recurring access' },
  { id: 'todos', label: 'To-Dos', hint: 'Internal tasks' },
]

const EVENTS_TABS = [
  { id: 'products', label: 'Products', hint: 'Sellable items' },
  { id: 'event-types', label: 'Event Types', hint: 'Competition, recital, retreat…' },
  { id: 'saved-templates', label: 'Saved Templates', hint: 'Optional pre-filled purchases' },
]

const TABS = [...SCHEDULED_TABS, ...EVENTS_TABS]

function BoolBadge({ value }) {
  return value
    ? <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-success/10 text-success">Yes</span>
    : <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">No</span>
}

function DragHandle(props) {
  return (
    <button
      type="button"
      className="cursor-grab active:cursor-grabbing p-1 text-muted-foreground hover:text-foreground touch-none"
      aria-label="Drag to reorder"
      {...props}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  )
}

function SortableServiceRow({ service, selectedIds, toggleOne, onEdit, onDelete, onToggleStatus, onToggleMemberships }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: service._id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => onEdit(service)}
    >
      <TableCell className="py-3 pl-2 pr-0 w-8" onClick={(e) => e.stopPropagation()}>
        <DragHandle {...attributes} {...listeners} />
      </TableCell>
      <TableCell className="py-3 pl-2 pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selectedIds.includes(service._id)} onClick={(e) => { e.stopPropagation(); toggleOne(service._id) }} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
      </TableCell>
      <TableCell className="py-3 px-4">
        <div className="flex items-center gap-3">
          <div
            className={`h-9 w-9 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${service.color ? '' : 'bg-muted text-muted-foreground'}`}
            style={service.color ? { backgroundColor: service.color, color: '#fff' } : undefined}
          >
            {service.serviceName.charAt(0).toUpperCase()}
          </div>
          <p className="text-sm font-normal text-foreground">{service.serviceName}</p>
        </div>
      </TableCell>
      <TableCell className="py-3 px-4">
        <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-mono font-medium bg-muted text-foreground border border-border">{service.serviceCode}</span>
      </TableCell>
      <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{service.locationID?.name || <span className="text-muted-foreground">—</span>}</p></TableCell>
      <TableCell className="py-3 px-4 max-w-[200px]"><p className="text-sm text-muted-foreground truncate">{service.description || '—'}</p></TableCell>
      <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{service.price != null ? `$${Number(service.price).toFixed(2)}` : '—'}</p></TableCell>
      <TableCell className="py-3 px-4"><BoolBadge value={service.isChargeable} /></TableCell>
      <TableCell className="py-3 px-4"><BoolBadge value={service.isSundry} /></TableCell>
      <TableCell className="py-3 px-4"><BoolBadge value={service.countOnCalendar} /></TableCell>
      <TableCell className="py-3 px-4">
        {service.documents?.length > 0 ? (
          <div className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5 text-muted-foreground" /><span className="text-sm text-foreground">{service.documents.length}</span></div>
        ) : <span className="text-sm text-muted-foreground">—</span>}
      </TableCell>
      <TableCell className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={!!service.showOnMemberships}
          onClick={() => onToggleMemberships(service)}
          className="rounded border-border data-[state=checked]:bg-violet-600 data-[state=checked]:border-violet-600"
        />
      </TableCell>
      <TableCell className="py-3 px-4">
        <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', service.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'].join(' ')}>
          {service.isActive ? 'Active' : 'Inactive'}
        </span>
      </TableCell>
      <TableCell className="py-3 pr-4 pl-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(service)}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleStatus(service)}>{service.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(service)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function SortablePackageRow({ pkg, selectedIds, toggleOne, onDelete, onDuplicate, onToggleStatus, router }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pkg._id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => router.push(`/calendar/packages/${pkg._id}`)}
    >
      <TableCell className="py-3 pl-2 pr-0 w-8" onClick={(e) => e.stopPropagation()}>
        <DragHandle {...attributes} {...listeners} />
      </TableCell>
      <TableCell className="py-3 pl-2 pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selectedIds.includes(pkg._id)} onClick={(e) => { e.stopPropagation(); toggleOne(pkg._id) }} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
      </TableCell>
      <TableCell className="py-3 px-4">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold bg-brand text-brand-foreground">
            {pkg.packageName.charAt(0).toUpperCase()}
          </span>
          <p className="text-sm font-medium text-foreground">{pkg.packageName}</p>
        </div>
      </TableCell>
      <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{pkg.locationID?.name || <span className="text-muted-foreground">—</span>}</p></TableCell>
      <TableCell className="py-3 px-4 max-w-[200px]"><p className="text-sm text-muted-foreground truncate">{pkg.description || '—'}</p></TableCell>
      <TableCell className="py-3 px-4">
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-foreground">
          {pkg.services?.length ?? 0} service{(pkg.services?.length ?? 0) !== 1 ? 's' : ''}
        </span>
      </TableCell>
      <TableCell className="py-3 px-4">
        <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', pkg.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'].join(' ')}>
          {pkg.isActive ? 'Active' : 'Inactive'}
        </span>
      </TableCell>
      <TableCell className="py-3 pr-4 pl-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/calendar/packages/${pkg._id}`)}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(pkg)}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleStatus(pkg)}>{pkg.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(pkg)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function ServicesTab() {
  const [serviceType, setServiceType] = useState('private')
  const [services, setServices] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingService, setEditingService] = useState(null)

  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadServices = useCallback(async (page, search, type) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize), type })
      if (search) params.set('search', search)
      const result = await api.get(`/api/calendar-service?${params}`)
      if (result.success) {
        const data = Array.isArray(result.data) ? result.data : []
        setServices(data)
        setTotalCount(result.pagination?.total ?? data.length)
      } else {
        toast.error('Failed to load services', { description: result.error })
      }
    } catch {
      toast.error('Error', { description: 'Unable to load services' })
    } finally {
      setLoading(false)
      setSelectedIds([])
    }
  }, [pageSize])

  useEffect(() => {
    setCurrentPage(1)
    setSelectedIds([])
  }, [serviceType])

  useEffect(() => { loadServices(currentPage, searchQuery, serviceType) }, [currentPage, searchQuery, serviceType, loadServices])

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setServices((prev) => {
      const oldIndex = prev.findIndex((s) => s._id === active.id)
      const newIndex = prev.findIndex((s) => s._id === over.id)
      const reordered = arrayMove(prev, oldIndex, newIndex)
      persistOrder(reordered)
      return reordered
    })
  }

  async function persistOrder(ordered) {
    const startIndex = (currentPage - 1) * pageSize
    const result = await api.patch('/api/calendar-service/reorder', {
      order: ordered.map((s) => s._id),
      startIndex,
      type: serviceType,
    })
    if (!result.success) {
      toast.error('Failed to save order', { description: result.error })
      loadServices(currentPage, searchQuery, serviceType)
    }
  }

  const toggleOne = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const toggleAll = () => { if (selectedIds.length === services.length) setSelectedIds([]); else setSelectedIds(services.map((s) => s._id)) }

  async function handleDelete(service) {
    if (!window.confirm(`Delete "${service.serviceName}"? This cannot be undone.`)) return
    try {
      const result = await api.delete(`/api/calendar-service/${service._id}`)
      if (result.success) { toast.success('Service deleted'); loadServices(currentPage, searchQuery, serviceType) }
      else toast.error('Delete failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to delete service' }) }
  }

  async function handleToggleStatus(service) {
    try {
      const result = await api.patch(`/api/calendar-service/${service._id}/toggle`)
      if (result.success) { toast.success(`Service ${service.isActive ? 'deactivated' : 'activated'}`); loadServices(currentPage, searchQuery, serviceType) }
      else toast.error('Failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to update service status' }) }
  }

  async function handleToggleMemberships(service) {
    try {
      const result = await api.put(`/api/calendar-service/${service._id}`, { showOnMemberships: !service.showOnMemberships })
      if (result.success) {
        setServices((prev) => prev.map((s) => s._id === service._id ? { ...s, showOnMemberships: !service.showOnMemberships } : s))
        toast.success(service.showOnMemberships ? 'Removed from memberships' : 'Added to memberships')
      } else toast.error('Failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to update service' }) }
  }

  if (loading && services.length === 0) {
    return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading services…" /></div>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Private / Group sub-tabs */}
      <div className="inline-flex rounded-lg border border-border bg-background p-0.5 w-fit">
        {[{ v: 'private', label: 'Private' }, { v: 'group', label: 'Group' }, { v: 'intro', label: 'Intro' }].map((opt) => (
          <button
            key={opt.v}
            type="button"
            onClick={() => setServiceType(opt.v)}
            className={[
              'h-8 px-5 rounded-md text-[13px] font-medium transition-colors',
              serviceType === opt.v ? 'bg-brand text-brand-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <SearchInput
          className="w-[220px] shrink-0"
          placeholder={`Search ${serviceType} services…`}
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-brand bg-background border border-border">
            {totalCount} {totalCount === 1 ? 'service' : 'services'}
          </span>
          <Button
            className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0"
            onClick={() => { setEditingService(null); setDialogOpen(true) }}
          >
            <Plus className="h-4 w-4" />
            Add Service
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card min-h-[480px] flex flex-col">
        <div className="flex-1 overflow-x-auto">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
                  <TableHead className="w-8 py-3 pl-2 pr-0" />
                  <TableHead className="w-12 py-3 pl-2 pr-0">
                    <Checkbox checked={selectedIds.length === services.length && services.length > 0} onClick={toggleAll} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
                  </TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Service Name</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Service Code</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Location</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Description</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Price</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Chargeable</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Sundry</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">On Calendar</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Documents</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Memberships</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
                  <TableHead className="w-12 py-3 pr-4 pl-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext items={services.map((s) => s._id)} strategy={verticalListSortingStrategy}>
                  {services.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={14} className="py-16 text-center text-sm text-muted-foreground">
                        {searchQuery ? 'No services match your search.' : `No ${serviceType} services yet. Click "Add Service" to create one.`}
                      </TableCell>
                    </TableRow>
                  ) : services.map((service) => (
                    <SortableServiceRow
                      key={service._id}
                      service={service}
                      selectedIds={selectedIds}
                      toggleOne={toggleOne}
                      onEdit={(s) => { setEditingService(s); setDialogOpen(true) }}
                      onDelete={handleDelete}
                      onToggleStatus={handleToggleStatus}
                      onToggleMemberships={handleToggleMemberships}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        </div>
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          loading={loading}
          pageSize={pageSize}
          setPageSize={setPageSize}
          setCurrentPage={setCurrentPage}
        />
      </div>

      <ServiceDialog open={dialogOpen} onClose={() => setDialogOpen(false)} service={editingService} onRefresh={() => loadServices(currentPage, searchQuery, serviceType)} />
    </div>
  )
}

function LessonsTab() {
  const [lessons, setLessons] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingLesson, setEditingLesson] = useState(null)

  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const loadLessons = useCallback(async (page, search) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) })
      if (search) params.set('search', search)
      const result = await api.get(`/api/lesson?${params}`)
      if (result.success) {
        const data = Array.isArray(result.data) ? result.data : []
        setLessons(data)
        setTotalCount(result.pagination?.total ?? data.length)
      } else {
        toast.error('Failed to load lessons', { description: result.error })
      }
    } catch { toast.error('Error', { description: 'Unable to load lessons' }) }
    finally { setLoading(false); setSelectedIds([]) }
  }, [pageSize])

  useEffect(() => { loadLessons(currentPage, searchQuery) }, [currentPage, searchQuery, loadLessons])

  const toggleOne = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const toggleAll = () => { if (selectedIds.length === lessons.length) setSelectedIds([]); else setSelectedIds(lessons.map((l) => l._id)) }

  const isActiveLesson = (lesson) => { const end = lesson?.endDate ? new Date(lesson.endDate) : null; return !end || end >= new Date() }

  async function handleDelete(lesson) {
    if (!window.confirm(`Delete "${lesson.name}"? This cannot be undone.`)) return
    try {
      const result = await api.delete(`/api/lesson/${lesson._id}`)
      if (result.success) { toast.success('Lesson deleted'); loadLessons(currentPage, searchQuery) }
      else toast.error('Delete failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to delete lesson' }) }
  }

  if (loading && lessons.length === 0) {
    return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading lessons…" /></div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          className="w-[220px] shrink-0"
          placeholder="Search lessons…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-brand bg-background border border-border">
            {totalCount} {totalCount === 1 ? 'lesson' : 'lessons'}
          </span>
          <Button
            className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0"
            onClick={() => { setEditingLesson(null); setDialogOpen(true) }}
          >
            <Plus className="h-4 w-4" />
            Create New
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card min-h-[480px] flex flex-col">
        <div className="flex-1 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
                <TableHead className="w-12 py-3 pl-4 pr-0">
                  <Checkbox checked={selectedIds.length === lessons.length && lessons.length > 0} onClick={toggleAll} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
                </TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Lesson</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Location Name</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Duration</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Unit</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Color</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Active</TableHead>
                <TableHead className="w-12 py-3 pr-4 pl-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lessons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                    {searchQuery ? 'No lessons match your search.' : 'No lessons yet. Click "Create New" to add one.'}
                  </TableCell>
                </TableRow>
              ) : lessons.map((lesson) => (
                <TableRow key={lesson._id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <TableCell className="py-3 pl-4 pr-0">
                    <Checkbox checked={selectedIds.includes(lesson._id)} onClick={() => toggleOne(lesson._id)} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
                  </TableCell>
                  <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{lesson.name}</p></TableCell>
                  <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{typeof lesson.locationID === 'object' ? (lesson.locationID?.name || '—') : '—'}</p></TableCell>
                  <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{lesson.duration ?? 50}</p></TableCell>
                  <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{lesson.unit ?? 1}</p></TableCell>
                  <TableCell className="py-3 px-4">
                    {lesson.color ? (
                      <div className="flex items-center gap-2">
                        <span className="h-6 w-10 rounded border border-black/10 shrink-0" style={{ backgroundColor: lesson.color }} />
                        <span className="text-xs font-mono text-muted-foreground">{lesson.color}</span>
                      </div>
                    ) : <span className="text-sm text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-3 px-4">
                    <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', isActiveLesson(lesson) ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'].join(' ')}>
                      {isActiveLesson(lesson) ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 pr-4 pl-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditingLesson(lesson); setDialogOpen(true) }}>Edit</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(lesson)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          loading={loading}
          pageSize={pageSize}
          setPageSize={setPageSize}
          setCurrentPage={setCurrentPage}
        />
      </div>

      <LessonDialog open={dialogOpen} onClose={() => setDialogOpen(false)} lesson={editingLesson} onRefresh={() => loadLessons(currentPage, searchQuery)} />
    </div>
  )
}

function PackagesTab() {
  const router = useRouter()
  const [packages, setPackages] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState([])

  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadPackages = useCallback(async (page, search) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) })
      if (search) params.set('search', search)
      const result = await api.get(`/api/package?${params}`)
      if (result.success) {
        setPackages(Array.isArray(result.data) ? result.data : [])
        setTotalCount(result.pagination?.total ?? 0)
      } else {
        toast.error('Failed to load packages', { description: result.error })
      }
    } catch { toast.error('Error', { description: 'Unable to load packages' }) }
    finally { setLoading(false); setSelectedIds([]) }
  }, [pageSize])

  useEffect(() => { loadPackages(currentPage, searchQuery) }, [currentPage, searchQuery, loadPackages])

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setPackages((prev) => {
      const oldIndex = prev.findIndex((p) => p._id === active.id)
      const newIndex = prev.findIndex((p) => p._id === over.id)
      const reordered = arrayMove(prev, oldIndex, newIndex)
      persistOrder(reordered)
      return reordered
    })
  }

  async function persistOrder(ordered) {
    const startIndex = (currentPage - 1) * pageSize
    const result = await api.patch('/api/package/reorder', {
      order: ordered.map((p) => p._id),
      startIndex,
    })
    if (!result.success) {
      toast.error('Failed to save order', { description: result.error })
      loadPackages(currentPage, searchQuery)
    }
  }

  const toggleOne = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const toggleAll = () => { if (selectedIds.length === packages.length) setSelectedIds([]); else setSelectedIds(packages.map((p) => p._id)) }

  async function handleDelete(pkg) {
    if (!window.confirm(`Delete "${pkg.packageName}"? This cannot be undone.`)) return
    try {
      const result = await api.delete(`/api/package/${pkg._id}`)
      if (result.success) { toast.success('Package deleted'); loadPackages(currentPage, searchQuery) }
      else toast.error('Delete failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to delete package' }) }
  }

  async function handleToggleStatus(pkg) {
    try {
      const result = await api.patch(`/api/package/${pkg._id}/toggle`)
      if (result.success) { toast.success(`Package ${pkg.isActive ? 'deactivated' : 'activated'}`); loadPackages(currentPage, searchQuery) }
      else toast.error('Failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to update package status' }) }
  }

  if (loading && packages.length === 0) {
    return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading packages…" /></div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          className="w-[220px] shrink-0"
          placeholder="Search packages…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-brand bg-background border border-border">
            {totalCount} {totalCount === 1 ? 'package' : 'packages'}
          </span>
          <Button
            className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0"
            onClick={() => router.push('/calendar/packages/new')}
          >
            <Plus className="h-4 w-4" />
            Add Package
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card min-h-[480px] flex flex-col">
        <div className="flex-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
                  <TableHead className="w-8 py-3 pl-2 pr-0" />
                  <TableHead className="w-12 py-3 pl-2 pr-0">
                    <Checkbox checked={selectedIds.length === packages.length && packages.length > 0} onClick={toggleAll} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
                  </TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Package Name</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Location</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Description</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Services</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
                  <TableHead className="w-12 py-3 pr-4 pl-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext items={packages.map((p) => p._id)} strategy={verticalListSortingStrategy}>
                  {packages.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                        {searchQuery ? 'No packages match your search.' : 'No packages yet. Click "Add Package" to create one.'}
                      </TableCell>
                    </TableRow>
                  ) : packages.map((pkg) => (
                    <SortablePackageRow
                      key={pkg._id}
                      pkg={pkg}
                      selectedIds={selectedIds}
                      toggleOne={toggleOne}
                      onDelete={handleDelete}
                      onDuplicate={(p) => duplicateCatalogEntity('package', p._id, router)}
                      onToggleStatus={handleToggleStatus}
                      router={router}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        </div>
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          loading={loading}
          pageSize={pageSize}
          setPageSize={setPageSize}
          setCurrentPage={setCurrentPage}
        />
      </div>
    </div>
  )
}

function SortableMembershipRow({ membership, selectedIds, toggleOne, onDelete, onDuplicate, onToggleStatus, router }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: membership._id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={() => router.push(`/calendar/memberships/${membership._id}`)}
    >
      <TableCell className="py-3 pl-2 pr-0 w-8" onClick={(e) => e.stopPropagation()}>
        <DragHandle {...attributes} {...listeners} />
      </TableCell>
      <TableCell className="py-3 pl-2 pr-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selectedIds.includes(membership._id)} onClick={(e) => { e.stopPropagation(); toggleOne(membership._id) }} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
      </TableCell>
      <TableCell className="py-3 px-4">
        <div className="flex items-center gap-3">
          <span className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white" style={{ backgroundColor: membership.color || '#6366f1' }}>
            {membership.membershipName.charAt(0).toUpperCase()}
          </span>
          <p className="text-sm font-medium text-foreground">{membership.membershipName}</p>
        </div>
      </TableCell>
      <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{membership.durationDays ? `${membership.durationDays} days` : '—'}</p></TableCell>
      <TableCell className="py-3 px-4"><p className="text-sm text-foreground">${Number(membership.price ?? 0).toFixed(2)}</p></TableCell>
      <TableCell className="py-3 px-4">
        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-foreground">
          {membership.services?.length ?? 0} service{(membership.services?.length ?? 0) !== 1 ? 's' : ''}
        </span>
      </TableCell>
      <TableCell className="py-3 px-4">
        <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', membership.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'].join(' ')}>
          {membership.isActive ? 'Active' : 'Inactive'}
        </span>
      </TableCell>
      <TableCell className="py-3 pr-4 pl-0" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => router.push(`/calendar/memberships/${membership._id}`)}>Edit</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDuplicate(membership)}>Duplicate</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggleStatus(membership)}>{membership.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(membership)}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}

function MembershipsTab() {
  const router = useRouter()
  const [memberships, setMemberships] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState([])

  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const loadMemberships = useCallback(async (page, search) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) })
      if (search) params.set('search', search)
      const result = await api.get(`/api/membership?${params}`)
      if (result.success) {
        setMemberships(Array.isArray(result.data) ? result.data : [])
        setTotalCount(result.pagination?.total ?? 0)
      } else {
        toast.error('Failed to load memberships', { description: result.error })
      }
    } catch { toast.error('Error', { description: 'Unable to load memberships' }) }
    finally { setLoading(false); setSelectedIds([]) }
  }, [pageSize])

  useEffect(() => { loadMemberships(currentPage, searchQuery) }, [currentPage, searchQuery, loadMemberships])

  function handleDragEnd(event) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setMemberships((prev) => {
      const oldIndex = prev.findIndex((m) => m._id === active.id)
      const newIndex = prev.findIndex((m) => m._id === over.id)
      return arrayMove(prev, oldIndex, newIndex)
    })
  }

  const toggleOne = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const toggleAll = () => { if (selectedIds.length === memberships.length) setSelectedIds([]); else setSelectedIds(memberships.map((m) => m._id)) }

  async function handleDelete(membership) {
    if (!window.confirm(`Delete "${membership.membershipName}"? This cannot be undone.`)) return
    try {
      const result = await api.delete(`/api/membership/${membership._id}`)
      if (result.success) { toast.success('Membership deleted'); loadMemberships(currentPage, searchQuery) }
      else toast.error('Delete failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to delete membership' }) }
  }

  async function handleToggleStatus(membership) {
    try {
      const result = await api.patch(`/api/membership/${membership._id}/toggle`)
      if (result.success) { toast.success(`Membership ${membership.isActive ? 'deactivated' : 'activated'}`); loadMemberships(currentPage, searchQuery) }
      else toast.error('Failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to update membership status' }) }
  }

  if (loading && memberships.length === 0) {
    return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading memberships…" /></div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          className="w-[220px] shrink-0"
          placeholder="Search memberships…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-brand bg-background border border-border">
            {totalCount} {totalCount === 1 ? 'membership' : 'memberships'}
          </span>
          <Button
            className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0"
            onClick={() => router.push('/calendar/memberships/new')}
          >
            <Plus className="h-4 w-4" />
            Add Membership
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card min-h-[480px] flex flex-col">
        <div className="flex-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
                  <TableHead className="w-8 py-3 pl-2 pr-0" />
                  <TableHead className="w-12 py-3 pl-2 pr-0">
                    <Checkbox checked={selectedIds.length === memberships.length && memberships.length > 0} onClick={toggleAll} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
                  </TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Membership Name</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Duration</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Price</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Services</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
                  <TableHead className="w-12 py-3 pr-4 pl-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext items={memberships.map((m) => m._id)} strategy={verticalListSortingStrategy}>
                  {memberships.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-16 text-center text-sm text-muted-foreground">
                        {searchQuery ? 'No memberships match your search.' : 'No memberships yet. Click "Add Membership" to create one.'}
                      </TableCell>
                    </TableRow>
                  ) : memberships.map((membership) => (
                    <SortableMembershipRow
                      key={membership._id}
                      membership={membership}
                      selectedIds={selectedIds}
                      toggleOne={toggleOne}
                      onDelete={handleDelete}
                      onDuplicate={(m) => duplicateCatalogEntity('membership', m._id, router)}
                      onToggleStatus={handleToggleStatus}
                      router={router}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        </div>
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          loading={loading}
          pageSize={pageSize}
          setPageSize={setPageSize}
          setCurrentPage={setCurrentPage}
        />
      </div>
    </div>
  )
}

function ToDosTab() {
  const [todos, setTodos] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTodo, setEditingTodo] = useState(null)

  const [pageSize, setPageSize] = useState(ROWS_PER_PAGE)
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))

  const loadTodos = useCallback(async (page, search) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(pageSize) })
      if (search) params.set('search', search)
      const result = await api.get(`/api/todo?${params}`)
      if (result.success) {
        const data = Array.isArray(result.data) ? result.data : []
        setTodos(data)
        setTotalCount(result.pagination?.total ?? data.length)
      } else {
        toast.error('Failed to load to-dos', { description: result.error })
      }
    } catch { toast.error('Error', { description: 'Unable to load to-dos' }) }
    finally { setLoading(false); setSelectedIds([]) }
  }, [pageSize])

  useEffect(() => { loadTodos(currentPage, searchQuery) }, [currentPage, searchQuery, loadTodos])

  const toggleOne = (id) => setSelectedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  const toggleAll = () => { if (selectedIds.length === todos.length) setSelectedIds([]); else setSelectedIds(todos.map((t) => t._id)) }

  async function handleDelete(todo) {
    if (!window.confirm(`Delete "${todo.name}"? This cannot be undone.`)) return
    try {
      const result = await api.delete(`/api/todo/${todo._id}`)
      if (result.success) { toast.success('To-do deleted'); loadTodos(currentPage, searchQuery) }
      else toast.error('Delete failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to delete to-do' }) }
  }

  async function handleToggleStatus(todo) {
    try {
      const result = await api.patch(`/api/todo/${todo._id}/toggle`)
      if (result.success) { toast.success(`To-do ${todo.isActive ? 'deactivated' : 'activated'}`); loadTodos(currentPage, searchQuery) }
      else toast.error('Failed', { description: result.error })
    } catch { toast.error('Error', { description: 'Unable to update to-do status' }) }
  }

  if (loading && todos.length === 0) {
    return <div className="flex items-center justify-center h-64"><GlobalLoader variant="center" size="md" text="Loading to-dos…" /></div>
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <SearchInput
          className="w-[220px] shrink-0"
          placeholder="Search to-dos…"
          value={searchQuery}
          onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
        />
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-brand bg-background border border-border">
            {totalCount} {totalCount === 1 ? 'to-do' : 'to-dos'}
          </span>
          <Button
            className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0"
            onClick={() => { setEditingTodo(null); setDialogOpen(true) }}
          >
            <Plus className="h-4 w-4" />
            Add To-Do
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card min-h-[480px] flex flex-col">
        <div className="flex-1 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
                <TableHead className="w-12 py-3 pl-4 pr-0">
                  <Checkbox checked={selectedIds.length === todos.length && todos.length > 0} onClick={toggleAll} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
                </TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">To-Do</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Location Name</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Duration</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Color</TableHead>
                <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
                <TableHead className="w-12 py-3 pr-4 pl-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {todos.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center text-sm text-muted-foreground">
                    {searchQuery ? 'No to-dos match your search.' : 'No to-dos yet. Click "Add To-Do" to create one.'}
                  </TableCell>
                </TableRow>
              ) : todos.map((todo) => (
                <TableRow key={todo._id} className="border-b border-border hover:bg-muted/30 transition-colors">
                  <TableCell className="py-3 pl-4 pr-0">
                    <Checkbox checked={selectedIds.includes(todo._id)} onClick={() => toggleOne(todo._id)} className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand" />
                  </TableCell>
                  <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{todo.name}</p></TableCell>
                  <TableCell className="py-3 px-4">
                    <p className="text-sm text-foreground">
                      {Array.isArray(todo.locationID)
                        ? (todo.locationID.map((l) => l?.name).filter(Boolean).join(', ') || '—')
                        : (todo.locationID?.name || '—')}
                    </p>
                  </TableCell>
                  <TableCell className="py-3 px-4"><p className="text-sm text-foreground">{todo.duration ?? 50}</p></TableCell>
                  <TableCell className="py-3 px-4">
                    {todo.color ? (
                      <div className="flex items-center gap-2">
                        <span className="h-6 w-10 rounded border border-black/10 shrink-0" style={{ backgroundColor: todo.color }} />
                        <span className="text-xs font-mono text-muted-foreground">{todo.color}</span>
                      </div>
                    ) : <span className="text-sm text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="py-3 px-4">
                    <span className={['inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', todo.isActive ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'].join(' ')}>
                      {todo.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 pr-4 pl-0">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setEditingTodo(todo); setDialogOpen(true) }}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleStatus(todo)}>{todo.isActive ? 'Deactivate' : 'Activate'}</DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(todo)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          loading={loading}
          pageSize={pageSize}
          setPageSize={setPageSize}
          setCurrentPage={setCurrentPage}
        />
      </div>

      <ToDoDialog open={dialogOpen} onClose={() => setDialogOpen(false)} todo={editingTodo} onRefresh={() => loadTodos(currentPage, searchQuery)} />
    </div>
  )
}

const GROUPS = [
  { id: 'scheduled', label: 'Scheduled Offerings', tabs: SCHEDULED_TABS },
  { id: 'events', label: 'Events & Purchases', tabs: EVENTS_TABS },
]

function PillTabs({ tabs, activeTab, onSelect }) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-full bg-muted p-1 w-fit">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={[
              'px-5 py-1.5 rounded-full text-sm font-medium transition-all',
              isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

function SetupContent() {
  const searchParams = useSearchParams()
  const initialTab = (() => {
    const tab = searchParams.get('tab')
    return TABS.find((t) => t.id === tab) ? tab : 'services'
  })()
  const [activeGroup, setActiveGroup] = useState(
    () => GROUPS.find((g) => g.tabs.some((t) => t.id === initialTab))?.id || 'scheduled',
  )
  const [activeTab, setActiveTab] = useState(initialTab)
  const [purchaseOpen, setPurchaseOpen] = useState(false)

  const group = GROUPS.find((g) => g.id === activeGroup) || GROUPS[0]

  function selectGroup(id) {
    if (id === activeGroup) return
    setActiveGroup(id)
    setActiveTab(GROUPS.find((g) => g.id === id).tabs[0].id)
  }

  const content = (
    <>
      {activeTab === 'services' && <ServicesTab />}
      {activeTab === 'lessons' && <LessonsTab />}
      {activeTab === 'packages' && <PackagesTab />}
      {activeTab === 'memberships' && <MembershipsTab />}
      {activeTab === 'todos' && <ToDosTab />}
      {activeTab === 'products' && <ProductsTab />}
      {activeTab === 'event-types' && <EventTypesTab />}
      {activeTab === 'saved-templates' && <SavedTemplatesTab />}
    </>
  )

  return (
    <div className="min-h-full flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">Setup</h1>
          </div>
          <p className="text-sm font-normal text-muted-foreground">
            Configure what your business schedules, sells, and reuses.
          </p>
        </div>
        <Button
          className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0"
          onClick={() => setPurchaseOpen(true)}
        >
          <Plus className="h-4 w-4" />
          Create Event &amp; Purchase
        </Button>
      </div>

      {/* Level 1 — group selector */}
      <div className="flex items-center gap-1 border-b border-border">
        {GROUPS.map((g) => {
          const isActive = g.id === activeGroup
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => selectGroup(g.id)}
              className={[
                '-mb-px px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors',
                isActive ? 'border-brand text-brand' : 'border-transparent text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {g.label}
            </button>
          )
        })}
      </div>

      {/* Level 2 — tabs within the selected group */}
      <PillTabs tabs={group.tabs} activeTab={activeTab} onSelect={setActiveTab} />

      {content}

      <CreateEventPurchaseDialog open={purchaseOpen} onClose={() => setPurchaseOpen(false)} />
    </div>
  )
}

export default function SetupPage() {
  return (
    <MainLayout title="Setup" subtitle="Configure what your business schedules, sells, and reuses">
      <Suspense>
        <SetupContent />
      </Suspense>
    </MainLayout>
  )
}
