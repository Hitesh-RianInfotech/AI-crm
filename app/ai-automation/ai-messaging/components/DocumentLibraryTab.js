'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, FileText, CheckCircle, ChevronLeft, ChevronRight, Power, Eye, Trash2 } from 'lucide-react'
import { TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SearchInput from '@/components/ui/search-input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import api from '@/lib/api'
import { getToken } from '@/lib/auth'
import { useToast, toast as pushToast } from '@/components/ui/toast'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import LocationSelector, { ALL_BRANCHES_VALUE } from '@/components/shared/LocationSelector'
import {
  initLocationID,
  hasLocationSelection,
  toLocationPayload,
  appendLocationFields,
  locationBadgeLabel,
  workingLocationQueryParam,
  normalizeWorkingLocation,
} from '@/app/ai-automation/ai-calling/components/locationScope'

const PAGE_LIMIT = 10

function formatFileSize(bytes) {
  const b = Number(bytes)
  if (!Number.isFinite(b) || b <= 0) return '—'
  if (b < 1024) return `${b} B`
  const kb = b / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}

function isPdfFile(file) {
  if (!file) return false
  const n = String(file.name || '').toLowerCase()
  const t = String(file.type || '').toLowerCase()
  return t === 'application/pdf' || n.endsWith('.pdf')
}

function DocumentDialog({ open, onClose, doc, endpoint, entityLabel, onRefresh, defaultLocationID }) {
  const toast = useToast()
  const fileInputRef = useRef(null)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState(null)
  const [locationID, setLocationID] = useState([])

  const isEdit = !!doc

  useEffect(() => {
    if (!open) return
    if (doc) {
      setName(doc.name || '')
      setDescription(doc.description || '')
      setLocationID(initLocationID(doc))
    } else {
      setName('')
      setDescription('')
      setLocationID(defaultLocationID || [])
    }
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [open, doc, defaultLocationID])

  const pickFile = (f) => {
    if (!f) {
      setFile(null)
      return
    }
    if (!isPdfFile(f)) {
      toast.error({ title: 'Invalid file', message: 'Please choose a PDF file.' })
      setFile(null)
      return
    }
    setFile(f)
  }

  async function save() {
    if (!name.trim()) {
      toast.error({ title: 'Validation', message: 'Name is required' })
      return
    }
    if (!hasLocationSelection(locationID)) {
      toast.error({ title: 'Validation', message: 'Select a studio or All branches' })
      return
    }
    if (!isEdit && !file) {
      toast.error({ title: 'Validation', message: 'Please choose a PDF file' })
      return
    }
    setLoading(true)
    try {
      let result
      if (isEdit) {
        result = await api.put(`${endpoint}/${doc._id}`, {
          name: name.trim(),
          description: description.trim(),
          ...toLocationPayload(locationID),
        })
      } else {
        const fd = new FormData()
        fd.append('name', name.trim())
        fd.append('description', description.trim())
        fd.append('pdf', file)
        appendLocationFields(fd, locationID)
        result = await api.request(endpoint, { method: 'POST', body: fd })
      }

      if (result.success) {
        toast.success({
          title: isEdit ? 'Updated' : 'Uploaded',
          message: `${entityLabel} ${isEdit ? 'updated' : 'uploaded'} successfully`,
        })
        onRefresh?.()
        onClose?.()
      } else {
        toast.error({ title: 'Error', message: result.error || result.message || 'Unable to save' })
      }
    } catch {
      toast.error({ title: 'Error', message: 'Unexpected error occurred' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="2xl">
      <DialogContent onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit ${entityLabel}` : `Upload ${entityLabel}`}</DialogTitle>
          <DialogDescription>
            {isEdit ? `Update ${entityLabel.toLowerCase()} details.` : `Upload a PDF for this studio’s ${entityLabel.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <label className="mb-1 block text-sm font-medium">Studio scope *</label>
            <LocationSelector
              value={locationID}
              onChange={setLocationID}
              multiple
              allowAllBranches
              placeholder="Select studio(s)…"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Name *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Document name" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional description"
            />
          </div>
          {!isEdit && (
            <div>
              <label className="mb-1 block text-sm font-medium">PDF *</label>
              <Input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="gradient" onClick={save} disabled={loading}>
            {loading ? 'Saving…' : isEdit ? 'Save' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function DocumentLibraryTab({
  activeView,
  tabValue,
  endpoint,
  heading,
  subheading,
  entityLabel,
  entityPlural,
  requireActive = false,
}) {
  const toast = useToast()
  const [docs, setDocs] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingDoc, setEditingDoc] = useState(null)
  const [togglingId, setTogglingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [workingLocationID, setWorkingLocationID] = useState([])

  const locationQuery = workingLocationQueryParam(workingLocationID)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_LIMIT),
        search,
      })
      if (locationQuery) params.set('locationID', locationQuery)
      const result = await api.get(`${endpoint}?${params.toString()}`)
      if (result.success) {
        const data = result.data || {}
        setDocs(data.docs || [])
        setTotal(data.total || 0)
        setTotalPages(data.totalPages || 1)
      } else {
        pushToast.error('Error', { description: result.error || 'Failed to load documents' })
      }
    } catch {
      pushToast.error('Error', { description: 'Unable to load documents' })
    } finally {
      setLoading(false)
    }
  }, [endpoint, page, search, locationQuery])

  const handleViewFile = async (doc) => {
    try {
      const baseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8080').replace(/\/$/, '')
      const token = getToken()
      const response = await fetch(`${baseUrl}${endpoint}/${doc._id}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        pushToast.error('Error', { description: 'Unable to load file. Try re-uploading the document.' })
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      pushToast.error('Error', { description: 'Failed to open file.' })
    }
  }

  const handleSetActive = async (doc, next) => {
    setTogglingId(doc._id)
    try {
      const result = await api.put(`${endpoint}/${doc._id}`, { isActive: next })
      if (!result.success) {
        toast.error({ title: 'Error', message: result.error || result.message || 'Unable to update status' })
        return
      }
      toast.success({
        title: next ? 'Activated' : 'Deactivated',
        message: next
          ? (result.message || `"${doc.name}" is now active`)
          : `"${doc.name}" is no longer active`,
      })
      load()
    } catch {
      toast.error({ title: 'Error', message: 'Unexpected error' })
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"? This cannot be undone.`)) return
    setDeletingId(doc._id)
    try {
      const result = await api.delete(`${endpoint}/${doc._id}`)
      if (result.success) {
        toast.success({ title: 'Deleted', message: `"${doc.name}" has been deleted` })
        load()
      } else {
        toast.error({ title: 'Error', message: result.error || 'Unable to delete document' })
      }
    } catch {
      toast.error({ title: 'Error', message: 'Unexpected error' })
    } finally {
      setDeletingId(null)
    }
  }

  useEffect(() => {
    if (activeView !== tabValue) return
    load()
  }, [activeView, tabValue, load])

  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      setSearch(searchInput.trim())
    }, 350)
    return () => clearTimeout(t)
  }, [searchInput])

  return (
    <TabsContent value={tabValue} className="mt-6 flex-1 min-h-0 flex flex-col gap-6 outline-none">
      <div className="flex min-h-full w-full flex-col">
        <div className="mb-6">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">{heading}</h2>
            <span className="inline-flex items-center rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-brand">
              {total} {entityPlural}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{subheading}</p>
        </div>

        <div className="mb-4 max-w-md">
          <label className="mb-1.5 block text-sm font-medium">Working studio</label>
          <LocationSelector
            value={
              workingLocationID === ALL_BRANCHES_VALUE
                ? ALL_BRANCHES_VALUE
                : Array.isArray(workingLocationID) && workingLocationID.length
                  ? workingLocationID[0]
                  : null
            }
            onChange={(id) => {
              setWorkingLocationID(normalizeWorkingLocation(id))
              setPage(1)
            }}
            multiple={false}
            allowAllBranches
            showAllOption={false}
            placeholder="Filter by studio…"
          />
        </div>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <SearchInput
            className="w-full sm:w-[240px]"
            placeholder={`Search ${entityPlural}…`}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button
            variant="gradient"
            className="h-9 shrink-0 gap-2 rounded-lg px-4 text-sm font-medium"
            onClick={() => {
              setEditingDoc(null)
              setDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Upload {entityLabel}
          </Button>
        </div>

        {loading ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            Loading {entityPlural}…
          </div>
        ) : docs.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No {entityPlural} found.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {docs.map((d) => {
              const isLive = d.isActive && d.embeddingStatus === 'ready'
              return (
                <div
                  key={d._id}
                  className={cn(
                    'flex flex-col gap-4 rounded-xl border bg-card p-5 sm:flex-row sm:items-start sm:justify-between',
                    isLive ? 'border-brand/40 bg-brand/5' : 'border-border'
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <FileText className="h-4.5 w-4.5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{d.name}</span>
                        {isLive && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                            <CheckCircle className="h-3 w-3" /> Active
                          </span>
                        )}
                        {locationBadgeLabel(d) && (
                          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {locationBadgeLabel(d)}
                          </span>
                        )}
                      </div>
                      {d.description && (
                        <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{d.description}</p>
                      )}
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="truncate" title={d.originalFileName}>
                          {d.originalFileName}
                        </span>
                        <span aria-hidden>·</span>
                        <span>{formatFileSize(d.fileSize)}</span>
                        <span aria-hidden>·</span>
                        <span>{new Date(d.createdAt).toLocaleDateString()}</span>
                        {d.uploadedBy?.name && (
                          <>
                            <span aria-hidden>·</span>
                            <span>by {d.uploadedBy.name}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      title="View document"
                      className="h-8 w-8 p-0"
                      onClick={() => handleViewFile(d)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      title="Edit"
                      className="h-8 w-8 p-0"
                      onClick={() => {
                        setEditingDoc(d)
                        setDialogOpen(true)
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {isLive && !requireActive && (
                      <Button
                        variant="outline"
                        size="sm"
                        title="Deactivate"
                        className="h-8 w-8 p-0"
                        onClick={() => handleSetActive(d, false)}
                        disabled={togglingId === d._id}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {!isLive && (
                      <>
                        <Button
                          variant="gradient"
                          size="sm"
                          className="h-8 gap-1.5 px-3 text-xs"
                          onClick={() => handleSetActive(d, true)}
                          disabled={togglingId === d._id}
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          {togglingId === d._id ? 'Activating…' : 'Set active'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          title="Delete"
                          className="h-8 w-8 p-0 text-red-500 hover:border-red-300 hover:text-red-600"
                          onClick={() => handleDelete(d)}
                          disabled={deletingId === d._id}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1 text-xs"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <DocumentDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        doc={editingDoc}
        endpoint={endpoint}
        entityLabel={entityLabel}
        onRefresh={load}
        defaultLocationID={workingLocationID}
      />
    </TabsContent>
  )
}
