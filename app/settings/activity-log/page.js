'use client'

import { useState, useEffect } from 'react'
import { Activity, User, Clock, RefreshCw } from 'lucide-react'
import MainLayout from '@/components/layout/MainLayout'
import SearchInput from '@/components/ui/search-input'
import { Badge } from '@/components/ui/badge'
import StyledSelect from '@/components/shared/StyledSelect'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import api from '@/lib/api'
import { useToast } from '@/components/ui/toast'
import { formatDate } from '@/lib/utils'
import { cn } from '@/lib/utils'

function extractUserFromDescription(description) {
  if (!description) return null
  const match = description.match(/[-–]\s*([^(]+)\s*\(([^)]+)\)\s*$/)
  if (match) return { name: match[1].trim(), role: match[2].trim() }
  return null
}

const ACTION_BADGE_VARIANT = {
  created: 'success',
  updated: 'warning',
  deleted: 'error',
  login: 'info',
  logout: 'secondary',
  default: 'secondary',
}

function getActionVariant(action) {
  if (!action) return 'secondary'
  const lower = action.toLowerCase()
  for (const key of Object.keys(ACTION_BADGE_VARIANT)) {
    if (lower.includes(key)) return ACTION_BADGE_VARIANT[key]
  }
  return ACTION_BADGE_VARIANT.default
}

export default function ActivityLogPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('All')
  const [moduleFilter, setModuleFilter] = useState('All')
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [limit, setLimit] = useState(10)
  const toast = useToast()

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery)
      setCurrentPage(1)
    }, 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  useEffect(() => {
    loadLogs()
  }, [debouncedSearch, currentPage, actionFilter, moduleFilter, limit])

  async function loadLogs() {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append('page', currentPage.toString())
      params.append('limit', limit.toString())
      if (debouncedSearch.trim()) params.append('search', debouncedSearch.trim())
      if (actionFilter !== 'All') params.append('action', actionFilter)
      if (moduleFilter !== 'All') params.append('module', moduleFilter)

      const result = await api.get(`/api/activity-log?${params.toString()}`)
      if (result.success) {
        setLogs(result.data || [])
        if (result.pagination) {
          const totalItems = result.pagination.total || 0
          setTotal(totalItems)
          setTotalPages(Math.ceil(totalItems / limit))
        }
      } else {
        toast.error({ title: 'Error', message: result.error || 'Failed to load activity logs' })
      }
    } catch (e) {
      console.error('loadLogs', e)
      toast.error({ title: 'Error', message: 'Failed to load activity logs' })
    } finally {
      setLoading(false)
    }
  }

  function handlePageChange(newPage) {
    setCurrentPage(newPage)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <MainLayout title="Activity Log" subtitle="Track all actions and changes across the system">
      <div className="space-y-4 md:space-y-6 min-h-full flex flex-col">
        {/* Header & Filters */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Activity Log</h2>
            <p className="text-sm text-muted-foreground">Track all actions and changes across the system</p>
          </div>

          <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end md:w-auto md:flex-nowrap md:gap-3">
            <SearchInput
              className="w-full sm:w-[300px]"
              placeholder="Search by user or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            <StyledSelect
              value={actionFilter}
              onChange={(value) => {
                setActionFilter(value)
                setCurrentPage(1)
              }}
              options={[
                { value: 'All', label: 'All Actions' },
                { value: 'created', label: 'Created' },
                { value: 'updated', label: 'Updated' },
                { value: 'deleted', label: 'Deleted' },
                { value: 'login', label: 'Login' },
                { value: 'logout', label: 'Logout' },
              ]}
              placeholder="All Actions"
              className="w-full sm:w-44"
            />

            <StyledSelect
              value={moduleFilter}
              onChange={(value) => {
                setModuleFilter(value)
                setCurrentPage(1)
              }}
              options={[
                { value: 'All', label: 'All Modules' },
                { value: 'leads', label: 'Leads' },
                { value: 'users', label: 'Users' },
                { value: 'locations', label: 'Locations' },
                { value: 'appointments', label: 'Appointments' },
                { value: 'campaigns', label: 'Campaigns' },
                { value: 'workflows', label: 'Workflows' },
                { value: 'auth', label: 'Auth' },
              ]}
              placeholder="All Modules"
              className="w-full sm:w-44"
            />

            <Button
              variant="outline"
              size="sm"
              onClick={() => loadLogs()}
              className="w-full sm:w-auto shrink-0"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <LoadingSpinner size="md" text="Loading activity logs..." />
          </div>
        )}

        {/* Table */}
        {!loading && (
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-[180px]">Timestamp</TableHead>
                  <TableHead className="w-[160px]">User</TableHead>
                  <TableHead className="w-[110px]">Action</TableHead>
                  <TableHead className="w-[120px]">Module</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-16">
                      <Activity className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">No activity logs found</p>
                      <p className="text-sm text-muted-foreground/70 mt-1">
                        {debouncedSearch || actionFilter !== 'All' || moduleFilter !== 'All'
                          ? 'Try adjusting your filters'
                          : 'Activity will appear here as users interact with the system'}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log, index) => (
                    <TableRow
                      key={log._id || log.id || index}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3 shrink-0" />
                          {log.createdAt ? formatDate(log.createdAt) : '—'}
                        </div>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const desc = log.description || log.message || log.details || ''
                          const parsed = extractUserFromDescription(desc)
                          const name =
                            log.userName ||
                            log.user?.name ||
                            log.performedBy?.name ||
                            log.actor?.name ||
                            log.createdBy?.name ||
                            parsed?.name ||
                            null
                          const sub =
                            log.userEmail ||
                            log.user?.email ||
                            log.performedBy?.email ||
                            log.actor?.email ||
                            log.createdBy?.email ||
                            (parsed ? parsed.role : null)
                          return (
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="h-6 w-6 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
                                <User className="h-3 w-3 text-brand" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                  {name || '—'}
                                </p>
                                {sub && (
                                  <p className="text-xs text-muted-foreground truncate">{sub}</p>
                                )}
                              </div>
                            </div>
                          )
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={getActionVariant(log.action)}
                          className="text-xs capitalize"
                        >
                          {log.action || '—'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground capitalize">
                          {log.module || log.entity || '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted-foreground line-clamp-2">
                          {log.description || log.message || log.details || '—'}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {!loading && total > 0 && (
          <div className="flex flex-row items-center border-t border-border pt-4 mt-auto">
            <div className="text-sm text-muted-foreground w-52 flex-shrink-0">
              Showing page {currentPage} of {totalPages} ({total} total {total === 1 ? 'entry' : 'entries'})
            </div>
            <div className="flex-1 flex justify-center">
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    size="sm"
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum
                      if (totalPages <= 5) {
                        pageNum = i + 1
                      } else if (currentPage <= 3) {
                        pageNum = i + 1
                      } else if (currentPage >= totalPages - 2) {
                        pageNum = totalPages - 4 + i
                      } else {
                        pageNum = currentPage - 2 + i
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={currentPage === pageNum ? 'gradient' : 'outline'}
                          onClick={() => handlePageChange(pageNum)}
                          size="sm"
                          className="min-w-[2.5rem]"
                        >
                          {pageNum}
                        </Button>
                      )
                    })}
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    size="sm"
                  >
                    Next
                  </Button>
                </div>
              )}
            </div>
            <div className="w-52 flex-shrink-0" aria-hidden="true" />
          </div>
        )}
      </div>
    </MainLayout>
  )
}
