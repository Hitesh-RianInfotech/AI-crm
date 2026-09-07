'use client'

import { Plus, Workflow } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { canManageDefaultWorkflows } from '@/lib/permissions'
import { getEffectiveBranch } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import SearchInput from '@/components/ui/search-input'
import GlobalLoader from '@/components/shared/GlobalLoader'
import WorkflowCard from '@/components/workflow/WorkflowCard'
import ConfirmDeleteWorkflowDialog from '@/components/workflow/ConfirmDeleteWorkflowDialog'
import { buildDuplicateWorkflowPayload } from '@/lib/workflow-normalize'

function parseWorkflowListResponse(data) {
  if (Array.isArray(data)) {
    return { ownWorkflows: data, defaultWorkflows: [] }
  }
  const ownWorkflows = Array.isArray(data?.ownWorkflows)
    ? data.ownWorkflows
    : Array.isArray(data?.workflows)
      ? data.workflows
      : []
  const defaultWorkflows = Array.isArray(data?.defaultWorkflows) ? data.defaultWorkflows : []
  return { ownWorkflows, defaultWorkflows }
}

function matchesSearch(workflow, query) {
  if (!query) return true
  const hay = [
    workflow?.name,
    workflow?.description,
    workflow?.listName,
    workflow?.event,
    workflow?.reason,
    workflow?.audienceMode,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(query)
}

export default function WorkflowManagerClient({ detailPathBase = '/ai-automation/workflows' }) {
  const router = useRouter()
  const builderHref = `${detailPathBase}/builder`
  const manageDefaults = canManageDefaultWorkflows()

  const [ownWorkflows, setOwnWorkflows] = useState([])
  const [defaultWorkflows, setDefaultWorkflows] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [listError, setListError] = useState('')
  const [listSuccessMsg, setListSuccessMsg] = useState('')
  const [search, setSearch] = useState('')

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState(null)
  const [actionId, setActionId] = useState(null)

  const loadWorkflows = async () => {
    setLoadingList(true)
    setLoadError('')
    setListError('')
    const res = await api.get('/api/workflow/')
    if (res?.success) {
      const parsed = parseWorkflowListResponse(res.data)
      setOwnWorkflows(parsed.ownWorkflows)
      setDefaultWorkflows(parsed.defaultWorkflows)
    } else {
      setLoadError(res?.error || 'Failed to load workflows.')
    }
    setLoadingList(false)
  }

  useEffect(() => {
    loadWorkflows()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onBranchChange = () => {
      setListSuccessMsg('')
      loadWorkflows()
    }
    window.addEventListener('branch-change', onBranchChange)
    return () => window.removeEventListener('branch-change', onBranchChange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = search.trim().toLowerCase()
  const filteredOwn = useMemo(
    () => ownWorkflows.filter((wf) => matchesSearch(wf, q)),
    [ownWorkflows, q],
  )
  const filteredDefaults = useMemo(
    () => defaultWorkflows.filter((wf) => matchesSearch(wf, q)),
    [defaultWorkflows, q],
  )

  const empty = !loadingList && ownWorkflows.length === 0 && defaultWorkflows.length === 0
  const searchEmpty =
    !loadingList &&
    !empty &&
    filteredOwn.length === 0 &&
    filteredDefaults.length === 0

  const requestDelete = (id) => {
    const wf =
      ownWorkflows.find((w) => (w?._id || w?.id) === id) ||
      defaultWorkflows.find((w) => (w?._id || w?.id) === id)
    setDeleteTarget({ id, name: wf?.name || '' })
    setDeleteDialogOpen(true)
  }

  const confirmDelete = async () => {
    const id = deleteTarget?.id
    if (!id || deleting) return
    setDeleting(true)
    setListError('')
    const res = await api.delete(`/api/workflow/${id}`)
    if (res?.success) {
      setDeleteDialogOpen(false)
      setDeleteTarget(null)
      await loadWorkflows()
    } else {
      setListError(res?.error || 'Failed to delete workflow.')
    }
    setDeleting(false)
  }

  const duplicateWorkflow = async (id) => {
    if (!id || duplicatingId) return
    setDuplicatingId(id)
    setListError('')
    setListSuccessMsg('')

    const fetchRes = await api.get(`/api/workflow/${id}`)
    if (!fetchRes?.success) {
      setListError(fetchRes?.error || 'Failed to load workflow to duplicate.')
      setDuplicatingId(null)
      return
    }

    const payload = buildDuplicateWorkflowPayload(fetchRes.data)
    if (!payload) {
      setListError('Could not prepare duplicate workflow.')
      setDuplicatingId(null)
      return
    }

    const branch = getEffectiveBranch()
    if (branch) payload.locationID = branch

    const res = await api.post('/api/workflow/', payload)
    if (res?.success) {
      await loadWorkflows()
      setListSuccessMsg(
        `"${payload.name}" was created as inactive for this location. Open it to customize, then set Active when ready.`,
      )
    } else {
      setListError(res?.error || 'Failed to duplicate workflow.')
    }

    setDuplicatingId(null)
  }

  const toggleDefault = async (id) => {
    if (!id || actionId) return
    setActionId(id)
    setListError('')
    setListSuccessMsg('')
    const res = await api.patch(`/api/workflow/${id}/default`)
    if (res?.success) {
      await loadWorkflows()
      const marked = Boolean(res?.data?.isDefault)
      setListSuccessMsg(
        marked
          ? 'Workflow marked as a default template for every location in your organisation.'
          : 'Workflow removed from defaults and scoped to the current branch.',
      )
    } else {
      setListError(res?.error || 'Failed to update default status.')
    }
    setActionId(null)
  }

  const setActivation = async (id, status) => {
    if (!id || actionId) return
    setActionId(id)
    setListError('')
    setListSuccessMsg('')
    const res = await api.patch(`/api/workflow/${id}/activation`, { status })
    if (res?.success) {
      setDefaultWorkflows((prev) =>
        prev.map((w) =>
          (w?._id || w?.id) === id ? { ...w, studioActivationStatus: status } : w,
        ),
      )
      setListSuccessMsg(
        status === 'active'
          ? 'Default template set to Active for your studio.'
          : 'Default template set to Inactive for your studio.',
      )
    } else {
      setListError(res?.error || 'Failed to update workflow activation.')
    }
    setActionId(null)
  }

  const toggleStatus = async (id, status) => {
    if (!id || actionId) return
    setActionId(id)
    setListError('')
    const prev = ownWorkflows.find((w) => (w?._id || w?.id) === id)?.status
    setOwnWorkflows((list) =>
      list.map((w) => ((w?._id || w?.id) === id ? { ...w, status } : w)),
    )
    const res = await api.patch(`/api/workflow/${id}`, { status })
    if (!res?.success) {
      setOwnWorkflows((list) =>
        list.map((w) => ((w?._id || w?.id) === id ? { ...w, status: prev } : w)),
      )
      setListError(res?.error || 'Failed to update workflow status.')
    }
    setActionId(null)
  }

  const toggleFavorite = async (id) => {
    if (!id || actionId) return
    setActionId(id)
    setOwnWorkflows((list) =>
      list.map((w) =>
        (w?._id || w?.id) === id ? { ...w, isFavorite: !w?.isFavorite } : w,
      ),
    )
    const res = await api.post(`/api/workflow/${id}/favorite`)
    if (!res?.success) {
      setOwnWorkflows((list) =>
        list.map((w) =>
          (w?._id || w?.id) === id ? { ...w, isFavorite: !w?.isFavorite } : w,
        ),
      )
      setListError(res?.error || 'Failed to update favorite.')
    }
    setActionId(null)
  }

  return (
    <div className="flex min-h-full flex-col space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-slate-600">Browse and manage your workflows</p>
        <Button variant="gradient" onClick={() => router.push(builderHref)}>
          <Plus className="mr-2 h-4 w-4" />
          Create New Workflow
        </Button>
      </div>

      <SearchInput
        className="max-w-sm"
        placeholder="Search workflows…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {listSuccessMsg ? (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {listSuccessMsg}
        </div>
      ) : null}

      {listError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {listError}
        </div>
      ) : null}

      {loadingList ? (
        <div className="flex items-center justify-center py-16">
          <GlobalLoader variant="inline" size="md" />
        </div>
      ) : null}

      {loadError && !loadingList ? (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-destructive">{loadError}</p>
            <div className="mt-4 flex justify-center">
              <Button variant="outline" onClick={loadWorkflows}>
                Retry
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!loadingList && !loadError && empty ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
              <Workflow className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="font-medium text-muted-foreground">No workflows yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a blank automation or activate a default template to get started.
            </p>
            <div className="mt-4 flex justify-center">
              <Button variant="gradient" onClick={() => router.push(builderHref)}>
                <Plus className="mr-2 h-4 w-4" />
                Create New Workflow
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!loadingList && !loadError && searchEmpty ? (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="font-medium text-muted-foreground">No matching workflows</p>
            <p className="mt-1 text-sm text-muted-foreground">Try a different search term.</p>
          </CardContent>
        </Card>
      ) : null}

      {!loadingList && !loadError && !empty && !searchEmpty ? (
        <div className="space-y-8">
          <section className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Your workflows</h3>
              <p className="text-sm text-slate-500">
                Owned by your studio
                {manageDefaults ? ' — mark one as a global default to share it' : ''}.
              </p>
            </div>
            {filteredOwn.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No studio workflows yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredOwn.map((wf) => (
                  <WorkflowCard
                    key={wf?._id || wf?.id}
                    workflow={wf}
                    variant="own"
                    canManageDefaults={manageDefaults}
                    onDelete={requestDelete}
                    onDuplicate={duplicateWorkflow}
                    onToggleDefault={toggleDefault}
                    onToggleStatus={toggleStatus}
                    onToggleFavorite={toggleFavorite}
                    duplicating={duplicatingId === (wf?._id || wf?.id)}
                    busy={actionId === (wf?._id || wf?.id)}
                    detailPathBase={detailPathBase}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Default templates</h3>
              <p className="text-sm text-slate-500">
                Org-wide templates — set Active / Inactive, or clone to customize for a location.
              </p>
            </div>
            {filteredDefaults.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  No default templates available yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {filteredDefaults.map((wf) => (
                  <WorkflowCard
                    key={wf?._id || wf?.id}
                    workflow={wf}
                    variant="default"
                    canManageDefaults={manageDefaults}
                    canEditDefault={manageDefaults}
                    onDelete={manageDefaults ? requestDelete : undefined}
                    onDuplicate={duplicateWorkflow}
                    onSetActivation={setActivation}
                    duplicating={duplicatingId === (wf?._id || wf?.id)}
                    busy={actionId === (wf?._id || wf?.id)}
                    detailPathBase={detailPathBase}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}

      <ConfirmDeleteWorkflowDialog
        open={deleteDialogOpen}
        busy={deleting}
        workflowName={deleteTarget?.name}
        onClose={() => {
          if (deleting) return
          setDeleteDialogOpen(false)
          setDeleteTarget(null)
        }}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
