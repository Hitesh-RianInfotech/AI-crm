'use client'

import { Plus, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { isSuperAdmin, hasPermission } from '@/lib/permissions'
import { getEffectiveBranch, getCurrentUser } from '@/lib/auth'
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

export default function WorkflowManagerClient({ detailPathBase = '/ai-automation/workflows' }) {
  const builderHref = `${detailPathBase}/builder`
  const superAdmin = isSuperAdmin()
  const canEditWorkflows = superAdmin || hasPermission('AiAndAutomation', 'workflows', 'edit')
  const currentOrgId = String(getCurrentUser()?.organisationID || getCurrentUser()?.organizationID || '')

  const canEditDefaultTemplate = (wf) => {
    if (superAdmin) return true
    if (!canEditWorkflows) return false
    const ownerOrg = String(wf?.organisationID?._id || wf?.organisationID || '')
    // Owning studio with edit permission may edit the shared template.
    return Boolean(ownerOrg) && ownerOrg === currentOrgId
  }

  const [ownWorkflows, setOwnWorkflows] = useState([])
  const [defaultWorkflows, setDefaultWorkflows] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState('')
  const [listSuccessMsg, setListSuccessMsg] = useState('')

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [duplicatingId, setDuplicatingId] = useState(null)
  const [actionId, setActionId] = useState(null)

  const totalCount = useMemo(
    () => ownWorkflows.length + defaultWorkflows.length,
    [ownWorkflows.length, defaultWorkflows.length],
  )

  const loadWorkflows = async () => {
    setLoadingList(true)
    setListError('')
    const res = await api.get('/api/workflow/')
    if (res?.success) {
      const parsed = parseWorkflowListResponse(res.data)
      setOwnWorkflows(parsed.ownWorkflows)
      setDefaultWorkflows(parsed.defaultWorkflows)
    } else {
      setListError(res?.error || 'Failed to load workflows.')
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

  const requestDelete = (id) => {
    const wf = ownWorkflows.find((w) => (w?._id || w?.id) === id)
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
          ? 'Workflow marked as a global default template.'
          : 'Workflow removed from global defaults.',
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
      await loadWorkflows()
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

  const empty = !loadingList && ownWorkflows.length === 0 && defaultWorkflows.length === 0

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 text-[16px]">
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[26px] font-bold text-foreground">Workflows</h2>
            <p className="text-[15px] text-muted-foreground">
              Automate follow-ups with timed SMS, email, and call steps. Activate shared defaults for
              your studio, or build your own.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-[15px] text-muted-foreground sm:inline">{totalCount} total</span>
            <button
              type="button"
              onClick={() => {
                setListSuccessMsg('')
                loadWorkflows()
              }}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-4 text-[14px] font-semibold text-foreground hover:bg-muted/40"
            >
              <RefreshCw className={cn('h-4 w-4', loadingList && 'animate-spin')} />
              Refresh
            </button>
            <Link
              href={builderHref}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--studio-primary)] px-4 text-[14px] font-semibold text-white hover:brightness-95"
            >
              <Plus className="h-4 w-4" />
              New workflow
            </Link>
          </div>
        </div>

        {listSuccessMsg ? (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-700 dark:text-emerald-300">
            {listSuccessMsg}
          </div>
        ) : null}

        {listError ? (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive">
            {listError}
          </div>
        ) : null}

        <div className="mt-4 space-y-8">
          {loadingList ? (
            <div className="rounded-xl border border-border bg-muted/40 px-4 py-8 text-center text-[13px] text-muted-foreground">
              Loading…
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-12 text-center">
              <p className="text-[14px] text-muted-foreground">
                No workflows yet. Build your first automation visually.
              </p>
              <Link
                href={builderHref}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--studio-primary)] px-4 text-[14px] font-semibold text-white hover:brightness-95"
              >
                <Plus className="h-4 w-4" />
                New workflow
              </Link>
            </div>
          ) : (
            <>
              <section className="space-y-3">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <h3 className="text-[16px] font-semibold text-foreground">Your workflows</h3>
                    <p className="text-[12px] text-muted-foreground">
                      Owned by your studio{superAdmin ? ' — mark one as a global default to share it' : ''}.
                    </p>
                  </div>
                  <span className="text-[12px] text-muted-foreground">{ownWorkflows.length}</span>
                </div>
                {ownWorkflows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-[13px] text-muted-foreground">
                    No studio workflows yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {ownWorkflows.map((wf) => (
                      <WorkflowCard
                        key={wf?._id || wf?.id}
                        workflow={wf}
                        variant="own"
                        isSuperAdmin={superAdmin}
                        onDelete={requestDelete}
                        onDuplicate={duplicateWorkflow}
                        onToggleDefault={toggleDefault}
                        duplicating={duplicatingId === (wf?._id || wf?.id)}
                        busy={actionId === (wf?._id || wf?.id)}
                        detailPathBase={detailPathBase}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section className="space-y-3">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <h3 className="text-[16px] font-semibold text-foreground">Default templates</h3>
                    <p className="text-[12px] text-muted-foreground">
                      Shared templates — set Active / Inactive for your studio, or duplicate to
                      customize.
                    </p>
                  </div>
                  <span className="text-[12px] text-muted-foreground">{defaultWorkflows.length}</span>
                </div>
                {defaultWorkflows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-[13px] text-muted-foreground">
                    No default templates available yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {defaultWorkflows.map((wf) => (
                      <WorkflowCard
                        key={wf?._id || wf?.id}
                        workflow={wf}
                        variant="default"
                        canEditDefault={canEditDefaultTemplate(wf)}
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
            </>
          )}
        </div>
      </div>

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
