'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  FolderOpen,
  Heart,
  MessageSquare,
  Pencil,
  Eye,
  Plus,
  Sparkles,
  Star,
  Tags,
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
import { templateScopeBadge } from '@/lib/template-scope'
import SetTemplateScopeDialog from '@/components/templates/SetTemplateScopeDialog'
import SmsCategoriesDialog from './SmsCategoriesDialog'
import SmsTemplateEditorDialog from './SmsTemplateEditorDialog'
import SmsTemplatePreviewDialog from './SmsTemplatePreviewDialog'
import {
  extractSmsCategoriesList,
  extractSmsTemplatesPayload,
  getSmsTemplateCategoryName,
} from '../smsBuilderApi'

const PAGE_SIZE = 9

const SORT_OPTIONS = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'favoritesFirst:desc', label: 'Favorites first' },
  { value: 'updatedAt:desc', label: 'Recently updated' },
]

const emptyBuckets = () => ({
  ownTemplates: [],
  orgDefaultTemplates: [],
  globalTemplates: [],
  list: [],
  hasBuckets: false,
})

export default function SmsTemplatesTab({ onCreateNew, dataVersion = 0, onDataChanged }) {
  const toast = useToast()
  const manageDefaults = canManageDefaultWorkflows()
  const superAdmin = isSuperAdmin()

  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [previewId, setPreviewId] = useState(null)

  const [view, setView] = useState('categories')
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [categories, setCategories] = useState([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState(null)
  const [categorySearch, setCategorySearch] = useState('')

  const [templates, setTemplates] = useState([])
  const [ownTemplates, setOwnTemplates] = useState([])
  const [orgDefaultTemplates, setOrgDefaultTemplates] = useState([])
  const [globalTemplates, setGlobalTemplates] = useState([])
  const [hasBuckets, setHasBuckets] = useState(false)
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

  const [selectedIds, setSelectedIds] = useState([])
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [togglingIds, setTogglingIds] = useState(new Set())
  const [heartAnimIds, setHeartAnimIds] = useState(new Set())

  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const [scopeTarget, setScopeTarget] = useState(null)
  const [scopeMode, setScopeMode] = useState('promote')
  const [scopeBusy, setScopeBusy] = useState(false)

  const pageNumbers = useMemo(() => {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1)
    const pages = new Set([1, totalPages, page, page - 1, page + 1].filter((n) => n >= 1 && n <= totalPages))
    return [...pages].sort((a, b) => a - b)
  }, [totalPages, page])

  const filteredCategories = useMemo(() => {
    const q = categorySearch.trim().toLowerCase()
    const list = [...categories].sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')))
    if (!q) return list
    return list.filter((c) => String(c?.name || '').toLowerCase().includes(q))
  }, [categories, categorySearch])

  const totalTemplatesAcrossCategories = useMemo(
    () => categories.reduce((sum, c) => sum + (Number(c.templateCount) || 0), 0),
    [categories]
  )

  const selectableTemplates = hasBuckets ? ownTemplates : templates

  const applyBuckets = useCallback((next) => {
    setOwnTemplates(next.ownTemplates || [])
    setOrgDefaultTemplates(next.orgDefaultTemplates || [])
    setGlobalTemplates(next.globalTemplates || [])
    setTemplates(next.list || [])
    setHasBuckets(Boolean(next.hasBuckets))
  }, [])

  const patchTemplateAcrossBuckets = useCallback((id, updater) => {
    const match = (t) => String(t?._id || t?.id) === String(id)
    const mapList = (arr) => (arr || []).map((t) => (match(t) ? updater(t) : t))
    setOwnTemplates((prev) => mapList(prev))
    setOrgDefaultTemplates((prev) => mapList(prev))
    setGlobalTemplates((prev) => mapList(prev))
    setTemplates((prev) => mapList(prev))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  const filtersKey = `${selectedCategory?._id || ''}|${debouncedSearch}|${statusFilter}|${favoriteFilter}|${sortValue}`
  const [activeFiltersKey, setActiveFiltersKey] = useState(filtersKey)
  if (filtersKey !== activeFiltersKey) {
    setActiveFiltersKey(filtersKey)
    if (page !== 1) setPage(1)
  }

  const selectedCategoryId = selectedCategory?._id ? String(selectedCategory._id) : ''

  const fetchCategories = useCallback(async () => {
    setCategoriesLoading(true)
    setCategoriesError(null)
    try {
      const result = await api.get('/api/smsBuilder/categories')
      if (result.success) {
        setCategories(extractSmsCategoriesList(result))
      } else {
        setCategoriesError(result.error || 'Failed to load categories')
      }
    } catch (e) {
      console.error(e)
      setCategoriesError('Failed to load categories')
    } finally {
      setCategoriesLoading(false)
    }
  }, [])

  const fetchTemplates = useCallback(async () => {
    if (!selectedCategoryId) return
    setLoading(true)
    setError(null)
    try {
      const [sortBy, sortOrder] = String(sortValue).split(':')
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        categoryID: selectedCategoryId,
        sortBy: sortBy || 'createdAt',
        sortOrder: sortOrder || 'desc',
      })
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
      if (statusFilter === 'active' || statusFilter === 'inactive') params.set('status', statusFilter)
      if (favoriteFilter === 'favorites') params.set('isFavorite', 'true')

      const result = await api.get(`/api/smsBuilder?${params.toString()}`)
      if (result.success) {
        const extracted = extractSmsTemplatesPayload(result)
        const {
          list,
          ownTemplates: own,
          orgDefaultTemplates: org,
          globalTemplates: global,
          hasBuckets: buckets,
          total,
          totalPages: totalPagesFromApi,
        } = extracted
        const computedPages = Math.ceil(Number(total) / PAGE_SIZE)
        const nextTotalPages = Math.max(
          1,
          Number(totalPagesFromApi) > 0 ? Number(totalPagesFromApi) : computedPages || 1
        )
        setOwnTemplates(own || [])
        setOrgDefaultTemplates(org || [])
        setGlobalTemplates(global || [])
        setHasBuckets(Boolean(buckets))
        setTemplates(list)
        setTotalCount(Number(total) || 0)
        setTotalPages(nextTotalPages)
        setSelectedIds([])
        if (page > nextTotalPages) setPage(nextTotalPages)
      } else {
        setError(result.error || 'Failed to fetch SMS templates')
      }
    } catch (e) {
      console.error(e)
      setError('Failed to fetch SMS templates')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch, statusFilter, favoriteFilter, sortValue, selectedCategoryId])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories, dataVersion])

  useEffect(() => {
    if (view === 'templates' && selectedCategoryId) fetchTemplates()
  }, [view, selectedCategoryId, fetchTemplates, dataVersion])

  useEffect(() => {
    if (!selectedCategoryId || view !== 'templates') return
    if (categoriesLoading) return
    const fresh = categories.find((c) => String(c._id) === selectedCategoryId)
    if (!fresh) {
      setView('categories')
      setSelectedCategory(null)
      return
    }
    if (
      fresh.name !== selectedCategory?.name ||
      Number(fresh.templateCount) !== Number(selectedCategory?.templateCount)
    ) {
      setSelectedCategory(fresh)
    }
  }, [categories, categoriesLoading, selectedCategory, selectedCategoryId, view])

  const resetTemplateState = () => {
    const empty = emptyBuckets()
    applyBuckets(empty)
    setSelectedIds([])
    setError(null)
  }

  const openCategory = (cat) => {
    setSelectedCategory(cat)
    setView('templates')
    setSearchQuery('')
    setDebouncedSearch('')
    setStatusFilter('all')
    setFavoriteFilter('all')
    setSortValue('createdAt:desc')
    setPage(1)
    resetTemplateState()
  }

  const backToCategories = () => {
    setView('categories')
    setSelectedCategory(null)
    resetTemplateState()
    fetchCategories()
  }

  const toggleSelected = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const toggleSelectAll = () => {
    const visibleIds = selectableTemplates.map((t) => t._id).filter(Boolean)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id))
    if (allSelected) setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)))
    else setSelectedIds((prev) => [...new Set([...prev, ...visibleIds])])
  }

  const openScopeDialog = (tpl, mode = 'promote') => {
    if (!tpl?._id) return
    setScopeTarget({
      id: tpl._id,
      name: tpl.name || '',
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
      const result = await api.patch(`/api/smsBuilder/${id}/scope`, { templateScope })
      if (!result.success) {
        toast.error({
          title: 'Scope update failed',
          message: result.error || result.errorData?.message || 'Could not update scope.',
        })
        return
      }
      toast.success({ title: 'Scope updated', message: 'Template scope saved successfully.' })
      setScopeDialogOpen(false)
      setScopeTarget(null)
      onDataChanged?.()
      fetchTemplates()
      fetchCategories()
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not update template scope.' })
    } finally {
      setScopeBusy(false)
    }
  }

  const deleteOne = async (tpl) => {
    if (!tpl?._id) return
    if (!confirm(`Delete template "${tpl.name}"? This cannot be undone.`)) return
    setDeletingId(tpl._id)
    try {
      const result = await api.delete(`/api/smsBuilder/${tpl._id}`)
      if (!result.success) {
        toast.error({ title: 'Delete failed', message: result.error || 'Could not delete template.' })
        return
      }
      toast.success({ title: 'Deleted', message: 'Template deleted successfully.' })
      onDataChanged?.()
      if (templates.length === 1 && page > 1) setPage((p) => Math.max(1, p - 1))
      else fetchTemplates()
      fetchCategories()
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not delete template.' })
    } finally {
      setDeletingId(null)
    }
  }

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return
    if (!confirm(`Delete ${selectedIds.length} templates? This cannot be undone.`)) return
    setBulkDeleting(true)
    try {
      const result = await api.request('/api/smsBuilder', {
        method: 'DELETE',
        body: JSON.stringify({ ids: selectedIds }),
      })
      if (!result.success) {
        toast.error({ title: 'Bulk delete failed', message: result.error || 'Could not delete templates.' })
        return
      }
      toast.success({ title: 'Deleted', message: 'Templates deleted successfully.' })
      onDataChanged?.()
      fetchTemplates()
      fetchCategories()
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not delete templates.' })
    } finally {
      setBulkDeleting(false)
    }
  }

  const toggleFavorite = async (tpl) => {
    if (!tpl?._id || togglingIds.has(tpl._id)) return
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
    patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, isFavorite: next }))
    try {
      const result = await api.patch(`/api/smsBuilder/${tpl._id}`, { isFavorite: next })
      if (!result.success) {
        patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, isFavorite: !next }))
      } else if (favoriteFilter === 'favorites' && !next) {
        fetchTemplates()
      }
    } catch (e) {
      patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, isFavorite: !next }))
    } finally {
      setTogglingIds((prev) => {
        const s = new Set(prev)
        s.delete(tpl._id)
        return s
      })
    }
  }

  const toggleStatus = async (tpl, variant = 'own') => {
    if (!tpl?._id || togglingIds.has(tpl._id)) return
    setTogglingIds((prev) => new Set(prev).add(tpl._id))

    if (variant === 'global') {
      const prev = tpl.studioActivationStatus
      const next = prev === 'active' ? 'inactive' : 'active'
      patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, studioActivationStatus: next }))
      try {
        const result = await api.patch(`/api/smsBuilder/${tpl._id}/activation`, { status: next })
        if (!result.success) {
          patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, studioActivationStatus: prev }))
          toast.error({
            title: 'Activation failed',
            message: result.error || 'Could not update studio activation.',
          })
        } else if (statusFilter !== 'all' && statusFilter !== next) {
          fetchTemplates()
        }
      } catch (e) {
        patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, studioActivationStatus: prev }))
        toast.error({ title: 'Error', message: 'Could not update studio activation.' })
      } finally {
        setTogglingIds((prevSet) => {
          const s = new Set(prevSet)
          s.delete(tpl._id)
          return s
        })
      }
      return
    }

    const next = tpl.status === 'active' ? 'inactive' : 'active'
    patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, status: next }))
    try {
      const result = await api.patch(`/api/smsBuilder/${tpl._id}`, { status: next })
      if (!result.success) {
        patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, status: tpl.status }))
      } else if (statusFilter !== 'all' && statusFilter !== next) {
        fetchTemplates()
      }
    } catch (e) {
      patchTemplateAcrossBuckets(tpl._id, (t) => ({ ...t, status: tpl.status }))
    } finally {
      setTogglingIds((prev) => {
        const s = new Set(prev)
        s.delete(tpl._id)
        return s
      })
    }
  }

  const onCategoriesChanged = () => {
    fetchCategories()
    onDataChanged?.()
    if (view === 'templates') fetchTemplates()
  }

  const canEditVariant = (variant) => {
    if (variant === 'org_default') return manageDefaults
    if (variant === 'global') return superAdmin
    return true
  }

  const showStatusSwitch = (variant) =>
    variant === 'own' || (variant === 'org_default' && manageDefaults) || variant === 'global'

  const renderTemplateCard = (tpl, index, variant = 'own') => {
    const categoryName = getSmsTemplateCategoryName(tpl)
    const isGlobal = variant === 'global'
    const isOwn = variant === 'own'
    const isOrgDefault = variant === 'org_default'
    const isInactive = isGlobal
      ? tpl.studioActivationStatus !== 'active'
      : tpl.status === 'inactive'
    const badge = templateScopeBadge(variant)
    const canEdit = canEditVariant(variant)
    const allowSelect = isOwn || !hasBuckets

    return (
      <Card
        key={tpl._id}
        className={cn(
          'group overflow-hidden border transition-all duration-200 rounded-2xl flex flex-col',
          'border-border/80 hover:border-primary/40 hover:shadow-lg bg-card',
          isInactive && 'opacity-75',
          tpl.isFavorite && isOwn && 'ring-1 ring-red-200/60'
        )}
        style={{ animationDelay: `${index * 0.04}s` }}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                {allowSelect ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(tpl._id)}
                    onChange={() => toggleSelected(tpl._id)}
                    className="h-4 w-4 mt-1 shrink-0"
                  />
                ) : (
                  <span className="h-4 w-4 mt-1 shrink-0" />
                )}
                <div className="min-w-0">
                  <CardTitle className="text-base line-clamp-2 leading-snug">
                    {tpl.name || 'Untitled template'}
                  </CardTitle>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Badge
                      variant={isInactive ? 'secondary' : 'default'}
                      className={cn(
                        'text-[10px] font-medium',
                        !isInactive &&
                          'bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-0'
                      )}
                    >
                      {isInactive ? 'Inactive' : 'Active'}
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
                    {tpl.isFavorite && isOwn ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] text-red-600 border-red-200"
                      >
                        Favorite
                      </Badge>
                    ) : null}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 line-clamp-4 whitespace-pre-wrap pl-6">
                {tpl.message || '—'}
              </p>
            </div>
            <div className="flex flex-col items-center gap-1 shrink-0">
              {showStatusSwitch(variant) ? (
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
            <Button
              variant="gradient"
              size="sm"
              className="text-xs flex-1"
              onClick={() => setPreviewId(tpl._id)}
              title="Preview"
            >
              <Eye className="h-3.5 w-3.5 mr-1.5" />
              Preview
            </Button>
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                className="text-xs flex-1"
                onClick={() => setEditingId(tpl._id)}
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

  const renderSection = ({ title, subtitle, items, variant }) => {
    if (!items?.length) return null
    return (
      <section className="space-y-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {items.map((tpl, index) => renderTemplateCard(tpl, index, variant))}
        </div>
      </section>
    )
  }

  const renderPagination = () => (
    <div className="flex flex-col gap-3 pt-2 mt-auto">
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
  )

  return (
    <TabsContent value="templates" className="mt-3 flex-1 min-h-0 flex flex-col gap-5">
      <SmsTemplateEditorDialog
        open={!!editingId}
        templateId={editingId}
        onClose={() => setEditingId(null)}
        onSaved={() => {
          fetchTemplates()
          fetchCategories()
          onDataChanged?.()
        }}
      />
      <SmsTemplatePreviewDialog
        open={!!previewId}
        templateId={previewId}
        onClose={() => setPreviewId(null)}
      />
      <SetTemplateScopeDialog
        open={scopeDialogOpen}
        busy={scopeBusy}
        templateName={scopeTarget?.name}
        currentScope={scopeTarget?.currentScope}
        mode={scopeMode}
        entityLabel="SMS template"
        onClose={() => {
          if (scopeBusy) return
          setScopeDialogOpen(false)
          setScopeTarget(null)
        }}
        onConfirm={confirmScope}
      />

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="min-w-0">
              {view === 'templates' && selectedCategory ? (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={backToCategories}
                    className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    All categories
                  </button>
                  <div>
                    <h2 className="text-lg font-semibold text-foreground truncate">
                      {selectedCategory.name || 'Category'}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Templates in this category
                      {!loading && totalCount >= 0 ? ` · ${totalCount}` : ''}
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-muted-foreground">
                    Browse by category, then open templates to preview, edit, or reuse.
                  </p>
                  {!categoriesLoading && categories.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {categories.length} categories · {totalTemplatesAcrossCategories} templates
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <Button variant="outline" className="w-full sm:w-auto" onClick={() => setCategoriesOpen(true)}>
                <Tags className="h-4 w-4 mr-2" />
                Manage categories
              </Button>
              <Button variant="gradient" className="w-full sm:w-auto" onClick={onCreateNew}>
                <Plus className="h-4 w-4 mr-2" />
                Create template
              </Button>
            </div>
          </div>

          <SmsCategoriesDialog
            open={categoriesOpen}
            onClose={() => setCategoriesOpen(false)}
            onChanged={onCategoriesChanged}
          />

          {view === 'categories' ? (
            <>
              <SearchInput
                className="max-w-md"
                placeholder="Search categories…"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
              />

              {categoriesLoading && (
                <div className="flex flex-col items-center justify-center py-16">
                  <LoadingSpinner size="lg" text="Loading categories…" />
                </div>
              )}

              {categoriesError && !categoriesLoading && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="py-8 text-center">
                    <p className="text-sm font-medium text-destructive">{categoriesError}</p>
                    <div className="mt-4 flex justify-center">
                      <Button variant="outline" onClick={fetchCategories}>
                        Retry
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!categoriesLoading && !categoriesError && filteredCategories.length === 0 && (
                <Card className="border-dashed rounded-2xl">
                  <CardContent className="py-14 text-center">
                    <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                      <FolderOpen className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="font-semibold text-foreground">
                      {categorySearch.trim() ? 'No matching categories' : 'No categories yet'}
                    </p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                      {categorySearch.trim()
                        ? 'Try a different search, or create a new category.'
                        : 'Create a category first, then add SMS templates inside it.'}
                    </p>
                    <Button variant="outline" className="mt-6" onClick={() => setCategoriesOpen(true)}>
                      <Tags className="h-4 w-4 mr-2" />
                      Manage categories
                    </Button>
                  </CardContent>
                </Card>
              )}

              {!categoriesLoading && !categoriesError && filteredCategories.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filteredCategories.map((cat, index) => {
                    const count = Number(cat.templateCount) || 0
                    return (
                      <button
                        key={cat._id}
                        type="button"
                        onClick={() => openCategory(cat)}
                        className={cn(
                          'text-left rounded-2xl border border-border/80 bg-card p-5',
                          'hover:border-primary/40 hover:shadow-md transition-all duration-200',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                        )}
                        style={{ animationDelay: `${index * 0.03}s` }}
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                            <FolderOpen className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-foreground truncate">{cat.name || 'Untitled'}</p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {count} {count === 1 ? 'template' : 'templates'}
                            </p>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center">
                  <SearchInput
                    className="flex-1 max-w-md"
                    placeholder="Search by name or message…"
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
                      <option value="all">All templates</option>
                      <option value="favorites">Favorites only</option>
                    </Select>
                    <Select
                      value={sortValue}
                      onChange={(e) => setSortValue(e.target.value)}
                      className="sm:min-w-[170px]"
                      aria-label="Sort templates"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleSelectAll}
                    disabled={selectableTemplates.length === 0 || loading}
                  >
                    {selectableTemplates.length > 0 &&
                    selectableTemplates.every((t) => selectedIds.includes(t._id))
                      ? 'Unselect visible'
                      : 'Select visible'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={bulkDelete}
                    disabled={selectedIds.length === 0 || bulkDeleting}
                  >
                    <Trash2 className="h-4 w-4 mr-1.5" />
                    {bulkDeleting ? 'Deleting…' : `Delete (${selectedIds.length})`}
                  </Button>
                </div>
              </div>

              {loading && (
                <div className="flex flex-col items-center justify-center py-16">
                  <LoadingSpinner size="lg" text="Loading templates…" />
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
                      <MessageSquare className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="font-semibold text-foreground">No templates in this category</p>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
                      {debouncedSearch || statusFilter !== 'all' || favoriteFilter !== 'all'
                        ? 'Try clearing search or filters.'
                        : 'Create a template and assign it to this category.'}
                    </p>
                    <Button variant="gradient" className="mt-6" onClick={onCreateNew}>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Create template
                    </Button>
                  </CardContent>
                </Card>
              )}

              {!loading && !error && templates.length > 0 && (
                <>
                  {hasBuckets ? (
                    <div className="space-y-8">
                      {renderSection({
                        title: 'Your templates',
                        subtitle: manageDefaults
                          ? 'Owned by this branch — mark one as an org or global default to share it.'
                          : 'Owned by this branch.',
                        items: ownTemplates,
                        variant: 'own',
                      })}
                      {renderSection({
                        title: 'Organisation defaults',
                        subtitle:
                          'Org-wide templates (all branches). Status is shared — managed with Default Workflows permission.',
                        items: orgDefaultTemplates,
                        variant: 'org_default',
                      })}
                      {renderSection({
                        title: 'Global templates',
                        subtitle:
                          'Shared across all studios — opt your studio in or out with the switch.',
                        items: globalTemplates,
                        variant: 'global',
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                      {templates.map((tpl, index) => renderTemplateCard(tpl, index, 'own'))}
                    </div>
                  )}

                  {renderPagination()}
                </>
              )}
            </>
          )}
    </TabsContent>
  )
}
