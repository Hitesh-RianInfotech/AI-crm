'use client'

import { Plus, Workflow } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { canManageDefaultWorkflows, isSuperAdmin } from '@/lib/permissions'
import { getEffectiveBranch } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import SearchInput from '@/components/ui/search-input'
import GlobalLoader from '@/components/shared/GlobalLoader'
import WorkflowCard from '@/components/workflow/WorkflowCard'
import ConfirmDeleteWorkflowDialog from '@/components/workflow/ConfirmDeleteWorkflowDialog'
import SetWorkflowScopeDialog from '@/components/workflow/SetWorkflowScopeDialog'
import { buildDuplicateWorkflowPayload } from '@/lib/workflow-normalize'

function parseWorkflowListResponse(data) {
  if (Array.isArray(data)) {
    return { ownWorkflows: data, orgDefaultWorkflows: [], globalWorkflows: [] }
  }
  const ownWorkflows = Array.isArray(data?.ownWorkflows)
    ? data.ownWorkflows
    : Array.isArray(data?.workflows)
      ? data.workflows
      : []
  // New API buckets; fall back to legacy defaultWorkflows → org defaults.
  const orgDefaultWorkflows = Array.isArray(data?.orgDefaultWorkflows)
    ? data.orgDefaultWorkflows
    : Array.isArray(data?.defaultWorkflows)
      ? data.defaultWorkflows
      : []
  const globalWorkflows = Array.isArray(data?.globalWorkflows) ? data.globalWorkflows : []
  return { ownWorkflows, orgDefaultWorkflows, globalWorkflows }
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
    workflow?.workflowScope,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return hay.includes(query)
}

function findWorkflow(id, ...lists) {
  for (const list of lists) {
    const found = list.find((w) => (w?._id || w?.id) === id)
    if (found) return found
  }
  return null
}

export default function WorkflowManagerClient({ detailPathBase = '/ai-automation/workflows' }) {
  const router = useRouter()
  const builderHref = `${detailPathBase}/builder`
  const manageDefaults = canManageDefaultWorkflows()
  const superAdmin = isSuperAdmin()

  const [ownWorkflows, setOwnWorkflows] = useState([])
  const [orgDefaultWorkflows, setOrgDefaultWorkflows] = useState([])
  const [globalWorkflows, setGlobalWorkflows] = useState([])
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

  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const [scopeTarget, setScopeTarget] = useState(null)
  const [scopeMode, setScopeMode] = useState('promote')
  const [scopeBusy, setScopeBusy] = useState(false)

  const loadWorkflows = async () => {
    setLoadingList(true)
    setLoadError('')
    setListError('')
    const res = await api.get('/api/workflow/')
    if (res?.success) {
      const parsed = parseWorkflowListResponse(res.data)
      setOwnWorkflows(parsed.ownWorkflows)
      setOrgDefaultWorkflows(parsed.orgDefaultWorkflows)
      setGlobalWorkflows(parsed.globalWorkflows)
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
  const filteredOrgDefaults = useMemo(
    () => orgDefaultWorkflows.filter((wf) => matchesSearch(wf, q)),
    [orgDefaultWorkflows, q],
  )
  const filteredGlobal = useMemo(
    () => globalWorkflows.filter((wf) => matchesSearch(wf, q)),
    [globalWorkflows, q],
  )

  const empty =
    !loadingList &&
    ownWorkflows.length === 0 &&
    orgDefaultWorkflows.length === 0 &&
    globalWorkflows.length === 0
  const searchEmpty =
    !loadingList &&
    !empty &&
    filteredOwn.length === 0 &&
    filteredOrgDefaults.length === 0 &&
    filteredGlobal.length === 0

  const requestDelete = (id) => {
    const wf = findWorkflow(id, ownWorkflows, orgDefaultWorkflows, globalWorkflows)
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

  const openScopeDialog = (id, currentScope, mode = 'promote') => {
    const wf = findWorkflow(id, ownWorkflows, orgDefaultWorkflows, globalWorkflows)
    setScopeTarget({
      id,
      name: wf?.name || '',
      currentScope: currentScope ?? wf?.workflowScope ?? null,
    })
    setScopeMode(mode)
    setScopeDialogOpen(true)
  }

  const confirmScope = async (workflowScope) => {
    const id = scopeTarget?.id
    if (!id || scopeBusy) return
    setScopeBusy(true)
    setListError('')
    setListSuccessMsg('')
    const res = await api.patch(`/api/workflow/${id}/scope`, { workflowScope })
    if (res?.success) {
      setScopeDialogOpen(false)
      setScopeTarget(null)
      await loadWorkflows()
      const label =
        workflowScope === 'global'
          ? 'Global template'
          : workflowScope === 'organization_default'
            ? 'Organisation default'
            : 'regular workflow'
      setListSuccessMsg(`Scope updated to ${label}.`)
    } else {
      setListError(res?.error || 'Failed to update workflow scope.')
    }
    setScopeBusy(false)
  }

  const setActivation = async (id, status) => {
    if (!id || actionId) return
    setActionId(id)
    setListError('')
    setListSuccessMsg('')
    const prev = globalWorkflows.find((w) => (w?._id || w?.id) === id)?.studioActivationStatus
    setGlobalWorkflows((list) =>
      list.map((w) =>
        (w?._id || w?.id) === id ? { ...w, studioActivationStatus: status } : w,
      ),
    )
    const res = await api.patch(`/api/workflow/${id}/activation`, { status })
    if (res?.success) {
      setListSuccessMsg(
        status === 'active'
          ? 'Global template enabled for your studio.'
          : 'Global template disabled for your studio.',
      )
    } else {
      setGlobalWorkflows((list) =>
        list.map((w) =>
          (w?._id || w?.id) === id ? { ...w, studioActivationStatus: prev } : w,
        ),
      )
      setListError(res?.error || 'Failed to update workflow activation.')
    }
    setActionId(null)
  }

  const toggleStatus = async (id, status, listKey = 'own') => {
    if (!id || actionId) return
    setActionId(id)
    setListError('')

    const setter = listKey === 'org' ? setOrgDefaultWorkflows : setOwnWorkflows
    const source = listKey === 'org' ? orgDefaultWorkflows : ownWorkflows
    const prev = source.find((w) => (w?._id || w?.id) === id)?.status

    setter((list) =>
      list.map((w) => ((w?._id || w?.id) === id ? { ...w, status } : w)),
    )
    const res = await api.patch(`/api/workflow/${id}`, { status })
    if (!res?.success) {
      setter((list) =>
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

  const renderSection = ({ title, subtitle, items, variant, emptyLabel, onToggleStatus }) => (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((wf) => (
            <WorkflowCard
              key={wf?._id || wf?.id}
              workflow={wf}
              variant={variant}
              canManageDefaults={manageDefaults}
              isSuperAdmin={superAdmin}
              onDelete={
                variant === 'own' ||
                (variant === 'org_default' && manageDefaults) ||
                (variant === 'global' && superAdmin)
                  ? requestDelete
                  : undefined
              }
              onDuplicate={duplicateWorkflow}
              onChangeScope={openScopeDialog}
              onSetActivation={setActivation}
              onToggleStatus={onToggleStatus}
              onToggleFavorite={toggleFavorite}
              duplicating={duplicatingId === (wf?._id || wf?.id)}
              busy={actionId === (wf?._id || wf?.id)}
              detailPathBase={detailPathBase}
            />
          ))}
        </div>
      )}
    </section>
  )

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
              Create a blank automation or enable a template to get started.
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
          {renderSection({
            title: 'Your workflows',
            subtitle: manageDefaults
              ? 'Owned by this branch — mark one as an org or global default to share it.'
              : 'Owned by this branch.',
            items: filteredOwn,
            variant: 'own',
            emptyLabel: 'No studio workflows yet.',
            onToggleStatus: (id, status) => toggleStatus(id, status, 'own'),
          })}
          {renderSection({
            title: 'Organisation defaults',
            subtitle:
              'Org-wide templates (all branches). Status is shared — managed with Default Workflows permission.',
            items: filteredOrgDefaults,
            variant: 'org_default',
            emptyLabel: 'No organisation default templates yet.',
            onToggleStatus: (id, status) => toggleStatus(id, status, 'org'),
          })}
          {renderSection({
            title: 'Global templates',
            subtitle: 'Shared across all studios — opt your studio in or out with the switch.',
            items: filteredGlobal,
            variant: 'global',
            emptyLabel: 'No global templates available yet.',
            onToggleStatus: undefined,
          })}
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

      <SetWorkflowScopeDialog
        open={scopeDialogOpen}
        busy={scopeBusy}
        workflowName={scopeTarget?.name}
        currentScope={scopeTarget?.currentScope}
        mode={scopeMode}
        onClose={() => {
          if (scopeBusy) return
          setScopeDialogOpen(false)
          setScopeTarget(null)
        }}
        onConfirm={confirmScope}
      />
    </div>
  )
}
