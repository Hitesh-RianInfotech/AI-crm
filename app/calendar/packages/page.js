'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, MoreHorizontal } from 'lucide-react'
import { useRouter } from 'next/navigation'
import MainLayout from '@/components/layout/MainLayout'
import SearchInput from '@/components/ui/search-input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import api from '@/lib/api'
import { toast } from '@/components/ui/toast'
import GlobalLoader from '@/components/shared/GlobalLoader'

const ROWS_PER_PAGE = 10

export default function PackagesPage() {
  const router = useRouter()
  const [packages, setPackages] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [initialLoad, setInitialLoad] = useState(true)
  const [selectedIds, setSelectedIds] = useState([])

  const totalPages = Math.max(1, Math.ceil(totalCount / ROWS_PER_PAGE))

  const loadPackages = useCallback(async (page, search) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(ROWS_PER_PAGE) })
      if (search) params.set('search', search)
      const result = await api.get(`/api/package?${params}`)
      if (result.success) {
        setPackages(Array.isArray(result.data) ? result.data : [])
        setTotalCount(result.pagination?.total ?? 0)
      } else {
        toast.error('Failed to load packages', { description: result.error })
      }
    } catch (e) {
      toast.error('Error', { description: 'Unable to load packages' })
    } finally {
      setLoading(false)
      setInitialLoad(false)
      setSelectedIds([])
    }
  }, [])

  useEffect(() => {
    loadPackages(currentPage, searchQuery)
  }, [currentPage, searchQuery, loadPackages])

  const toggleOne = (id) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const toggleAll = () => {
    if (selectedIds.length === packages.length) setSelectedIds([])
    else setSelectedIds(packages.map((p) => p._id))
  }

  async function handleDelete(pkg) {
    if (!window.confirm(`Delete "${pkg.packageName}"? This cannot be undone.`)) return
    try {
      const result = await api.delete(`/api/package/${pkg._id}`)
      if (result.success) {
        toast.success('Package deleted')
        loadPackages(currentPage, searchQuery)
      } else {
        toast.error('Delete failed', { description: result.error })
      }
    } catch (e) {
      toast.error('Error', { description: 'Unable to delete package' })
    }
  }

  async function handleDuplicate(pkg) {
    const src = await api.get(`/api/package/${pkg._id}`)
    if (!src.success) {
      toast.error('Duplicate failed', { description: src.error })
      return
    }
    const p = src.data
    const created = await api.post('/api/package', {
      packageName: `${p.packageName} (Copy)`,
      description: p.description,
      sortOrder: p.sortOrder,
      totalDays: p.totalDays,
      color: p.color,
      curriculumID: p.curriculumID?._id ?? p.curriculumID ?? undefined,
      isActive: p.isActive,
      locationID: (p.locationID || []).map((l) => l?._id ?? l).filter(Boolean),
      services: (p.services || []).map(({ _id, isChargeable, ...s }) => s),
    })
    if (created.success) {
      toast.success('Package duplicated')
      router.push(`/calendar/packages/${created.data._id}`)
    } else {
      toast.error('Duplicate failed', { description: created.error })
    }
  }

  async function handleToggleStatus(pkg) {
    try {
      const result = await api.patch(`/api/package/${pkg._id}/toggle`)
      if (result.success) {
        toast.success(`Package ${pkg.isActive ? 'deactivated' : 'activated'}`)
        loadPackages(currentPage, searchQuery)
      } else {
        toast.error('Failed', { description: result.error })
      }
    } catch (e) {
      toast.error('Error', { description: 'Unable to update package status' })
    }
  }

  if (initialLoad) {
    return (
      <MainLayout title="Packages" subtitle="">
        <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
          <GlobalLoader variant="center" size="md" text="Loading packages…" />
        </div>
      </MainLayout>
    )
  }

  return (
    <MainLayout title="Packages" subtitle="">
      <div className="min-h-full flex flex-col p-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">Packages</h1>
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium text-brand bg-background border border-border">
              {totalCount} {totalCount === 1 ? 'package' : 'packages'}
            </span>
          </div>
          <p className="text-sm font-normal text-muted-foreground">
            Manage your studio's service packages and bundles.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 mb-6">
          <SearchInput
            className="w-[220px] shrink-0"
            placeholder="Search packages…"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
          />
          <Button
            className="h-9 px-4 rounded-lg bg-brand hover:bg-brand-dark text-brand-foreground text-sm font-medium gap-2 shrink-0"
            onClick={() => router.push('/calendar/packages/new')}
          >
            <Plus className="h-4 w-4" />
            Add Package
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card min-h-[560px] flex flex-col">
          <div className="flex-1">
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
                  <TableHead className="w-12 py-3 pl-4 pr-0">
                    <Checkbox
                      checked={selectedIds.length === packages.length && packages.length > 0}
                      onClick={toggleAll}
                      className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand"
                    />
                  </TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Package Name</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Location</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Description</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Sort Order</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Color</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Services</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-medium text-muted-foreground">Status</TableHead>
                  <TableHead className="w-12 py-3 pr-4 pl-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {packages.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-16 text-center text-sm text-muted-foreground">
                      {searchQuery ? 'No packages match your search.' : 'No packages yet. Click "Add Package" to create one.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  packages.map((pkg) => (
                    <TableRow
                      key={pkg._id}
                      className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => router.push(`/calendar/packages/${pkg._id}`)}
                    >
                      <TableCell className="py-3 pl-4 pr-0" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedIds.includes(pkg._id)}
                          onClick={(e) => { e.stopPropagation(); toggleOne(pkg._id) }}
                          className="rounded border-border data-[state=checked]:bg-brand data-[state=checked]:border-brand"
                        />
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span
                            className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-sm font-bold text-white"
                            style={{ backgroundColor: pkg.color || '#6366f1' }}
                          >
                            {pkg.packageName.charAt(0).toUpperCase()}
                          </span>
                          <p className="text-sm font-medium text-foreground">{pkg.packageName}</p>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <p className="text-sm text-foreground">{pkg.locationID?.name || <span className="text-muted-foreground">—</span>}</p>
                      </TableCell>
                      <TableCell className="py-3 px-4 max-w-[200px]">
                        <p className="text-sm text-muted-foreground truncate">{pkg.description || '—'}</p>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <p className="text-sm text-foreground">{pkg.sortOrder ?? 0}</p>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-5 w-5 rounded-full shrink-0 border border-black/10"
                            style={{ backgroundColor: pkg.color || '#6366f1' }}
                          />
                          <span className="text-xs font-mono text-muted-foreground">{pkg.color || '—'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-muted text-foreground">
                          {pkg.services?.length ?? 0} service{(pkg.services?.length ?? 0) !== 1 ? 's' : ''}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 px-4">
                        <span className={[
                          'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                          pkg.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground',
                        ].join(' ')}>
                          {pkg.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </TableCell>
                      <TableCell className="py-3 pr-4 pl-0" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="p-1.5 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground"
                              aria-label="Actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => router.push(`/calendar/packages/${pkg._id}`)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDuplicate(pkg)}>Duplicate</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleToggleStatus(pkg)}>
                              {pkg.isActive ? 'Deactivate' : 'Activate'}
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-red-600" onClick={() => handleDelete(pkg)}>Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1 || loading}
              className="inline-flex items-center h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages || loading}
              className="inline-flex items-center h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </MainLayout>
  )
}
