'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Heart,
  LayoutTemplate,
  Mail,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react'
import { TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import SearchInput from '@/components/ui/search-input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import Switch from '@/components/ui/switch'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useToast } from '@/components/ui/toast'
import api from '@/lib/api'
import { canManageDefaultWorkflows, isSuperAdmin } from '@/lib/permissions'
import {
  mapTemplateInBuckets,
  templateScopeBadge,
} from '@/lib/template-scope'
import SetTemplateScopeDialog from '@/components/templates/SetTemplateScopeDialog'
import {
  extractEmailTemplatesPayload,
  getTemplateCategoryName,
} from '@/app/marketing/email-builder/emailBuilderApi'

const PAGE_SIZE = 12

const EMPTY_BUCKETS = {
  hasBuckets: false,
  ownTemplates: [],
  orgDefaultTemplates: [],
  globalTemplates: [],
  list: [],
}

const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'subject:asc', label: 'Subject A–Z' },
  { value: 'subject:desc', label: 'Subject Z–A' },
  { value: 'favoritesFirst:desc', label: 'Favorites first' },
  { value: 'updatedAt:desc', label: 'Recently updated' },
]

export default function TextEmailTemplatesTab({
  onCreateNew,
  onEdit,
  dataVersion = 0,
  onDataChanged,
}) {
  const toast = useToast()
  const manageDefaults = canManageDefaultWorkflows()
  const superAdmin = isSuperAdmin()

  const [buckets, setBuckets] = useState(EMPTY_BUCKETS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [favoriteFilter, setFavoriteFilter] = useState('all')
  const [sortValue, setSortValue] = useState('createdAt:desc')

  const [deletingId, setDeletingId] = useState(null)
  const [togglingIds, setTogglingIds] = useState(new Set())
  const [heartAnimIds, setHeartAnimIds] = useState(new Set())

  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const [scopeTarget, setScopeTarget] = useState(null)
  const [scopeMode, setScopeMode] = useState('promote')
  const [scopeBusy, setScopeBusy] = useState(false)

  const templates = buckets.list
  const ownTemplates = buckets.ownTemplates
  const orgDefaultTemplates = buckets.orgDefaultTemplates
  const globalTemplates = buckets.globalTemplates
  const hasBuckets = buckets.hasBuckets

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages = new Set([1, totalPages, page, page - 1, page + 1].filter((n) => n >= 1 && n <= totalPages))
    return [...pages].sort((a, b) => a - b)
  }, [totalPages, page])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  const filtersKey = `${debouncedSearch}|${statusFilter}|${favoriteFilter}|${sortValue}`
  const [activeFiltersKey, setActiveFiltersKey] = useState(filtersKey)
  if (filtersKey !== activeFiltersKey) {
    setActiveFiltersKey(filtersKey)
    if (page !== 1) setPage(1)
  }

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [sortBy, sortOrder] = String(sortValue).split(':')
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        format: 'text',
        sortBy: sortBy || 'createdAt',
        sortOrder: sortOrder || 'desc',
      })
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
      if (statusFilter === 'active' || statusFilter === 'inactive') params.set('status', statusFilter)
      if (favoriteFilter === 'favorites') params.set('isFavorite', 'true')

      const result = await api.get(`/api/email/builder?${params.toString()}`)
      if (result.success) {
        const extracted = extractEmailTemplatesPayload(result)
        setBuckets({
          hasBuckets: extracted.hasBuckets,
          ownTemplates: extracted.ownTemplates,
          orgDefaultTemplates: extracted.orgDefaultTemplates,
          globalTemplates: extracted.globalTemplates,
          list: extracted.list,
        })
        const total = Number(extracted.total) || 0
        setTotalCount(total)
        setTotalPages(Math.max(1, Number(extracted.totalPages) || Math.ceil(total / PAGE_SIZE) || 1))
      } else {
        setError(result.error || 'Failed to load text emails')
        setBuckets(EMPTY_BUCKETS)
      }
    } catch (e) {
      console.error(e)
      setError('Failed to load text emails')
      setBuckets(EMPTY_BUCKETS)
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, statusFilter, favoriteFilter, sortValue])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates, dataVersion])

  const canEditVariant = (variant) => {
    if (variant === 'org_default') return manageDefaults
    if (variant === 'global') return superAdmin
    return true
  }

  const deleteOne = async (tpl) => {
    if (!tpl?._id) return
    if (!confirm(`Delete text email "${tpl.subject}"? This cannot be undone.`)) return
    setDeletingId(tpl._id)
    try {
      const result = await api.delete(`/api/email/builder/${tpl._id}`)
      if (!result.success) {
        toast.error({ title: 'Delete failed', message: result.error || 'Could not delete.' })
        return
      }
      toast.success({ title: 'Deleted', message: 'Text email deleted.' })
      onDataChanged?.()
      if (templates.length === 1 && page > 1) setPage((p) => Math.max(1, p - 1))
      else fetchTemplates()
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not delete text email.' })
    } finally {
      setDeletingId(null)
    }
  }

  const toggleFavorite = async (tpl) => {
    if (togglingIds.has(tpl._id)) return
    setTogglingIds((prev) => new Set(prev).add(tpl._id))
    setHeartAnimIds((prev) => new Set(prev).add(tpl._id))
    setTimeout(() => {
      setHeartAnimIds((prev) => {
        const s = new Set(prev)
        s.delete(tpl._id)
        return s
      })
    }, 400)
    const next = !tpl.isFavorite
    setBuckets((prev) => mapTemplateInBuckets(prev, tpl._id, (t) => ({ ...t, isFavorite: next })))
    try {
      const result = await api.patch(`/api/email/builder/${tpl._id}`, { isFavorite: next })
      if (!result.success) {
        setBuckets((prev) =>
          mapTemplateInBuckets(prev, tpl._id, (t) => ({ ...t, isFavorite: !next }))
        )
      } else if (favoriteFilter === 'favorites' && !next) {
        fetchTemplates()
      }
    } catch {
      setBuckets((prev) =>
        mapTemplateInBuckets(prev, tpl._id, (t) => ({ ...t, isFavorite: !next }))
      )
    } finally {
      setTogglingIds((prev) => {
        const s = new Set(prev)
        s.delete(tpl._id)
        return s
      })
    }
  }

  const toggleStatus = async (tpl, variant = 'own') => {
    if (togglingIds.has(tpl._id)) return
    setTogglingIds((prev) => new Set(prev).add(tpl._id))

    if (variant === 'global') {
      const prevStatus = tpl.studioActivationStatus
      const next = prevStatus === 'active' ? 'inactive' : 'active'
      setBuckets((prev) =>
        mapTemplateInBuckets(prev, tpl._id, (t) => ({ ...t, studioActivationStatus: next }))
      )
      try {
        const result = await api.patch(`/api/email/builder/${tpl._id}/activation`, { status: next })
        if (!result.success) {
          setBuckets((prev) =>
            mapTemplateInBuckets(prev, tpl._id, (t) => ({
              ...t,
              studioActivationStatus: prevStatus,
            }))
          )
          toast.error({
            title: 'Activation failed',
            message: result.error || 'Could not update activation.',
          })
        }
      } catch {
        setBuckets((prev) =>
          mapTemplateInBuckets(prev, tpl._id, (t) => ({
            ...t,
            studioActivationStatus: prevStatus,
          }))
        )
        toast.error({ title: 'Error', message: 'Could not update activation.' })
      } finally {
        setTogglingIds((prev) => {
          const s = new Set(prev)
          s.delete(tpl._id)
          return s
        })
      }
      return
    }

    const next = tpl.status === 'active' ? 'inactive' : 'active'
    setBuckets((prev) => mapTemplateInBuckets(prev, tpl._id, (t) => ({ ...t, status: next })))
    try {
      const result = await api.patch(`/api/email/builder/${tpl._id}`, { status: next })
      if (!result.success) {
        setBuckets((prev) =>
          mapTemplateInBuckets(prev, tpl._id, (t) => ({ ...t, status: tpl.status }))
        )
      } else if (statusFilter !== 'all' && statusFilter !== next) {
        fetchTemplates()
      }
    } catch {
      setBuckets((prev) =>
        mapTemplateInBuckets(prev, tpl._id, (t) => ({ ...t, status: tpl.status }))
      )
    } finally {
      setTogglingIds((prev) => {
        const s = new Set(prev)
        s.delete(tpl._id)
        return s
      })
    }
  }

  const openScopeDialog = (tpl, mode = 'promote') => {
    if (!tpl?._id) return
    setScopeTarget({
      id: tpl._id,
      name: tpl.subject || '',
      currentScope: tpl.templateScope ?? null,
    })
    setScopeMode(mode)
    setScopeDialogOpen(true)
  }

  const confirmScope = async (templateScope) => {
    const id = scopeTarget?.id
    if (!id || scopeBusy) return
    setScopeBusy(true)
    try {
      const result = await api.patch(`/api/email/builder/${id}/scope`, { templateScope })
      if (!result.success) {
        toast.error({
          title: 'Scope update failed',
          message: result.error || 'Could not update template scope.',
        })
        return
      }
      toast.success({ title: 'Scope updated', message: 'Email template scope saved.' })
      setScopeDialogOpen(false)
      setScopeTarget(null)
      onDataChanged?.()
      fetchTemplates()
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not update template scope.' })
    } finally {
      setScopeBusy(false)
    }
  }

  const renderTemplateCard = (tpl, index, variant = 'own') => {
    const categoryName = getTemplateCategoryName(tpl)
    const isGlobal = variant === 'global'
    const isOwn = variant === 'own'
    const isOrgDefault = variant === 'org_default'
    const badge = templateScopeBadge(variant)
    const canEdit = canEditVariant(variant)
    const showStatusSwitch = isOwn || (isOrgDefault && manageDefaults) || isGlobal
    const isInactive = isGlobal
      ? tpl.studioActivationStatus !== 'active'
      : tpl.status === 'inactive'

    return (
      <Card
        key={tpl._id}
        className={cn(
          'group overflow-hidden border transition-all duration-200 rounded-2xl flex flex-col',
          'border-border/80 hover:border-primary/40 hover:shadow-lg bg-card',
          isInactive && 'opacity-75',
          isOwn && tpl.isFavorite && 'ring-1 ring-red-200/60'
        )}
        style={{ animationDelay: `${index * 0.04}s` }}
      >
        <CardHeader className="pb-2 pt-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <CardTitle className="text-base line-clamp-2 leading-snug">
                {tpl.subject || 'Untitled'}
              </CardTitle>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <Badge
                  variant={isInactive ? 'secondary' : 'default'}
                  className={cn(
                    'text-[10px] font-medium',
                    !isInactive && 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0'
                  )}
                >
                  {isInactive ? 'Inactive' : 'Active'}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  Text
                </Badge>
                {badge ? (
                  <span
                    className={cn(
                      'inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold',
                      badge.className
                    )}
                  >
                    {badge.label}
                  </span>
                ) : null}
                {categoryName ? (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {categoryName}
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-3 line-clamp-4 whitespace-pre-wrap">
                {tpl.body || '—'}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1 shrink-0">
              {showStatusSwitch ? (
                <Switch
                  checked={!isInactive}
                  onChange={() => toggleStatus(tpl, variant)}
                  disabled={togglingIds.has(tpl._id)}
                  title={isInactive ? 'Activate' : 'Deactivate'}
                  className="disabled:opacity-40 scale-75"
                />
              ) : null}
              {isOwn ? (
                <button
                  type="button"
                  onClick={() => toggleFavorite(tpl)}
                  disabled={togglingIds.has(tpl._id)}
                  title={tpl.isFavorite ? 'Remove favorite' : 'Add to favorites'}
                  className={cn(
                    'h-8 w-8 flex items-center justify-center rounded-full transition-all',
                    tpl.isFavorite
                      ? 'text-red-500 hover:bg-red-50'
                      : 'text-muted-foreground hover:bg-muted hover:text-red-400'
                  )}
                >
                  <Heart
                    className={cn(
                      'h-4 w-4',
                      tpl.isFavorite && 'fill-current',
                      heartAnimIds.has(tpl._id) && 'scale-125 transition-transform'
                    )}
                  />
                </button>
              ) : null}
            </div>
          </div>
        </CardHeader>

        <CardContent className="mt-auto pt-0 pb-3 space-y-2">
          <div className="flex items-center gap-2 px-1">
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs flex-1"
                onClick={() => onEdit?.(tpl)}
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => deleteOne(tpl)}
                disabled={deletingId === tpl._id}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>

          {manageDefaults && isOwn ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => openScopeDialog(tpl, 'promote')}
            >
              <Star className="h-3.5 w-3.5 mr-1.5" />
              Mark as default
            </Button>
          ) : null}

          {manageDefaults && (isOrgDefault || (isGlobal && superAdmin)) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => openScopeDialog(tpl, 'change')}
            >
              Change scope
            </Button>
          ) : null}

          {isOrgDefault && !manageDefaults ? (
            <p className="px-1 text-[11px] leading-snug text-muted-foreground">
              Organisation template — edit requires Default Workflows permission.
            </p>
          ) : null}
          {isGlobal && !superAdmin ? (
            <p className="px-1 text-[11px] leading-snug text-muted-foreground">
              Global template — use the switch to opt your studio in or out.
            </p>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  const renderSection = ({ title, subtitle, items, variant, emptyLabel }) => (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {items.map((tpl, index) => renderTemplateCard(tpl, index, variant))}
        </div>
      )}
    </section>
  )

  return (
    <TabsContent value="templates" className="mt-3 flex-1 min-h-0 flex flex-col gap-5">
      <SetTemplateScopeDialog
        open={scopeDialogOpen}
        busy={scopeBusy}
        templateName={scopeTarget?.name}
        currentScope={scopeTarget?.currentScope}
        mode={scopeMode}
        entityLabel="email template"
        onClose={() => {
          if (scopeBusy) return
          setScopeDialogOpen(false)
          setScopeTarget(null)
        }}
        onConfirm={confirmScope}
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Plain-text emails with your / organisation / global scope — same pattern as SMS and HTML email.
          </p>
          {!loading && totalCount >= 0 ? (
            <p className="text-xs text-muted-foreground mt-1">{totalCount} text email templates</p>
          ) : null}
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <Link
            href="/marketing/email-builder"
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium border border-input bg-background hover:bg-accent hover:text-accent-foreground h-10 px-4 py-2 w-full sm:w-auto"
          >
            <LayoutTemplate className="h-4 w-4" />
            HTML Email Builder
          </Link>
          <Button variant="gradient" className="w-full sm:w-auto" onClick={onCreateNew}>
            <Plus className="h-4 w-4 mr-2" />
            Create text email
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
          <SearchInput
            className="flex-1 max-w-md"
            placeholder="Search by subject or body…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <div className="flex flex-col sm:flex-row gap-2 flex-1 lg:flex-initial">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="sm:min-w-[140px]"
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
            <Select
              value={favoriteFilter}
              onChange={(e) => setFavoriteFilter(e.target.value)}
              className="sm:min-w-[140px]"
              aria-label="Filter by favorite"
            >
              <option value="all">All</option>
              <option value="favorites">Favorites</option>
            </Select>
            <Select
              value={sortValue}
              onChange={(e) => setSortValue(e.target.value)}
              className="sm:min-w-[160px]"
              aria-label="Sort"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <LoadingSpinner size="lg" text="Loading text emails…" />
        </div>
      )}

      {error && !loading && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={fetchTemplates}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && !error && templates.length === 0 && (
        <Card className="border-dashed rounded-2xl">
          <CardContent className="py-14 text-center">
            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
              <Mail className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground">No text emails yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
              Create a plain-text template, then mark it as an organisation default or global when needed.
            </p>
            <Button variant="gradient" className="mt-6" onClick={onCreateNew}>
              <Plus className="h-4 w-4 mr-2" />
              Create text email
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && !error && templates.length > 0 && (
        <div className="space-y-8 flex-1">
          {hasBuckets ? (
            <>
              {renderSection({
                title: 'Your templates',
                subtitle: 'Owned by this organisation / branch.',
                items: ownTemplates,
                variant: 'own',
                emptyLabel: 'No own text emails in this view.',
              })}
              {renderSection({
                title: 'Organisation defaults',
                subtitle: 'Shared with every branch in your organisation.',
                items: orgDefaultTemplates,
                variant: 'org_default',
                emptyLabel: 'No organisation default text emails.',
              })}
              {renderSection({
                title: 'Global templates',
                subtitle: 'Shared across studios. Opt in per studio.',
                items: globalTemplates,
                variant: 'global',
                emptyLabel: 'No global text emails.',
              })}
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {templates.map((tpl, index) => renderTemplateCard(tpl, index, 'own'))}
            </div>
          )}

          {totalPages > 1 ? (
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex items-center justify-center gap-1.5 flex-wrap">
                {pageNumbers.map((n, idx) => {
                  const prev = pageNumbers[idx - 1]
                  const showEllipsis = prev != null && n - prev > 1
                  return (
                    <span key={n} className="inline-flex items-center gap-1.5">
                      {showEllipsis ? (
                        <span className="text-muted-foreground text-sm px-1">…</span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setPage(n)}
                        disabled={loading || n === page}
                        className={cn(
                          'inline-flex items-center justify-center h-8 min-w-8 px-2 rounded-md text-sm font-medium border transition-colors disabled:opacity-50',
                          n === page
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-background border-border hover:bg-muted/40'
                        )}
                      >
                        {n}
                      </button>
                    </span>
                  )
                })}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1 || loading}
                >
                  Previous
                </Button>
                <span className="text-sm text-muted-foreground text-center">
                  Page {page} of {totalPages} · {totalCount} templates
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages || loading}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </TabsContent>
  )
}
