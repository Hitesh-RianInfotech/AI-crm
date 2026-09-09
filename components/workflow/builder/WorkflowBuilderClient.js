'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { getEffectiveBranch } from '@/lib/auth'
import { canManageDefaultWorkflows, isSuperAdmin } from '@/lib/permissions'
import { useWorkflowOptions } from '@/lib/useWorkflowOptions'
import { extractDynamicListsList } from '@/lib/dynamic-list-normalize'
import { hydrateContactGroupsFromAudience } from '@/lib/workflow-contact'
import WorkflowBuilderCanvas from '@/components/workflow/builder/WorkflowBuilderCanvas'
import WorkflowBuilderHeader from '@/components/workflow/builder/WorkflowBuilderHeader'
import WorkflowBuilderPropertiesPanel from '@/components/workflow/builder/WorkflowBuilderPropertiesPanel'
import WorkflowBuilderSidebar from '@/components/workflow/builder/WorkflowBuilderSidebar'
import WorkflowStepGuide from '@/components/workflow/builder/WorkflowStepGuide'
import PublishWorkflowDialog from '@/components/workflow/builder/PublishWorkflowDialog'
import { useWorkflowBuilderStore } from '@/components/workflow/builder/workflowBuilderStore'
import {
  graphToWorkflowPayload,
  workflowToGraph,
} from '@/components/workflow/builder/workflowGraphAdapter'
import { createBlankWorkflow } from '@/components/workflow/builder/mockWorkflowData'

function getIdFromUrl() {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('id')
}

export default function WorkflowBuilderClient() {
  const setOptions = useWorkflowBuilderStore((s) => s.setOptions)
  const loadWorkflowGraph = useWorkflowBuilderStore((s) => s.loadWorkflowGraph)
  const setSaveStatus = useWorkflowBuilderStore((s) => s.setSaveStatus)
  const setWorkflowId = useWorkflowBuilderStore((s) => s.setWorkflowId)
  const setIsActive = useWorkflowBuilderStore((s) => s.setIsActive)
  const guidedCategory = useWorkflowBuilderStore((s) => s.guidedCategory)
  const setGuidedCategory = useWorkflowBuilderStore((s) => s.setGuidedCategory)
  const nodes = useWorkflowBuilderStore((s) => s.nodes)
  const syncWorkflowUnlocks = useWorkflowBuilderStore((s) => s.syncWorkflowUnlocks)

  const setWorkflowName = useWorkflowBuilderStore((s) => s.setWorkflowName)
  const setWorkflowDescription = useWorkflowBuilderStore((s) => s.setWorkflowDescription)
  const setIsFavorite = useWorkflowBuilderStore((s) => s.setIsFavorite)
  const workflowName = useWorkflowBuilderStore((s) => s.workflowName)
  const workflowDescription = useWorkflowBuilderStore((s) => s.workflowDescription)
  const isFavorite = useWorkflowBuilderStore((s) => s.isFavorite)
  const isActive = useWorkflowBuilderStore((s) => s.isActive)

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [publishOpen, setPublishOpen] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [workflowScope, setWorkflowScope] = useState(null)

  const [dynamicLists, setDynamicLists] = useState([])
  const { forms, reasons } = useWorkflowOptions(true)

  useEffect(() => {
    setOptions({ forms, reasons, dynamicLists })
  }, [forms, reasons, dynamicLists, setOptions])

  // Sync unlock latches when Contact / Action become complete — never force tab changes.
  useEffect(() => {
    syncWorkflowUnlocks()
  }, [nodes, syncWorkflowUnlocks])

  useEffect(() => {
    let cancelled = false
    api.get('/api/dynamic-list?status=active&limit=200').then((res) => {
      if (cancelled) return
      if (res?.success) {
        setDynamicLists(extractDynamicListsList(res))
      } else {
        setDynamicLists([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Load an existing workflow when ?id= is present; otherwise start blank.
  useEffect(() => {
    const id = getIdFromUrl()
    if (!id) {
      const blank = createBlankWorkflow()
      setReadOnly(false)
      setWorkflowScope(null)
      loadWorkflowGraph({
        workflowId: null,
        workflowName: blank.workflowName,
        nodes: blank.nodes,
        edges: blank.edges,
        isActive: true,
      })
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError('')
    setReadOnly(false)
    setWorkflowScope(null)
    api.get(`/api/workflow/${id}`).then(async (res) => {
      if (cancelled) return
      if (res?.success && res.data) {
        const data = res.data
        const scope =
          data.workflowScope === 'organization_default' || data.workflowScope === 'global'
            ? data.workflowScope
            : null
        setWorkflowScope(scope)
        if (scope === 'global') {
          setReadOnly(!isSuperAdmin())
        } else if (scope === 'organization_default') {
          setReadOnly(!canManageDefaultWorkflows())
        } else {
          setReadOnly(false)
        }
        const graph = workflowToGraph(data)
        const trigger = graph.nodes?.find((n) => n.data?.category === 'trigger')
        const listId =
          res.data?.listID?._id ||
          res.data?.listID ||
          trigger?.data?.config?.listID
        const audienceMode =
          res.data?.audienceMode ||
          trigger?.data?.config?.audienceMode ||
          (listId ? 'list' : res.data?.baseCondition ? 'all' : '')

        if (trigger && (audienceMode === 'list' || audienceMode === 'all')) {
          let listConditionSource = null
          let listName = trigger.data.config.listName || ''
          let entityType =
            res.data?.entityType === 'customer' || trigger.data.config.entityType === 'customer'
              ? 'customer'
              : 'lead'
          const resolvedListId = listId ? String(listId) : ''

          if (audienceMode === 'list' && resolvedListId) {
            const listRes = await api.get(`/api/dynamic-list/${resolvedListId}`)
            if (!cancelled && listRes?.success && listRes.data) {
              const list = listRes.data
              listConditionSource = {
                conditions: list.conditions,
                groupLogics: list.groupLogics,
                conditionGroups: list.conditionGroups,
                conditionLogic: list.conditionLogic,
              }
              listName = list.name || listName
              entityType = list.entityType === 'customer' ? 'customer' : entityType
            }
          }

          if (!cancelled) {
            const hydrated = hydrateContactGroupsFromAudience({
              audienceMode,
              entityType,
              baseCondition: res.data?.baseCondition,
              additionalFilter: res.data?.additionalFilter,
              listConditionSource:
                audienceMode === 'list' ? listConditionSource || res.data?.baseCondition : null,
            })
            trigger.data.config = {
              ...trigger.data.config,
              entityType,
              audienceMode,
              listID: audienceMode === 'list' ? resolvedListId : '',
              listName: audienceMode === 'list' ? listName : '',
              conditionLogic: hydrated.conditionLogic,
              additionalConditionLogic: hydrated.additionalConditionLogic,
              groups: hydrated.groups,
              triggerType: 'list',
              event: 'non',
            }
          }
        }
        if (!cancelled) {
          loadWorkflowGraph({
            ...graph,
            workflowDescription: res.data?.description || '',
            isFavorite: Boolean(res.data?.isFavorite),
            isActive: (res.data?.status || 'active') !== 'inactive',
          })
        }
      } else if (!cancelled) {
        setLoadError(res?.error || 'Failed to load workflow.')
      }
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [loadWorkflowGraph])

  const persist = useCallback(
    async ({ publish = false, meta = null } = {}) => {
      setSaving(true)
      setSaveStatus('saving')

      if (readOnly) {
        setSaving(false)
        setSaveStatus('unsaved')
        toast.error('Default templates can’t be edited here. Duplicate it from the workflows list first.')
        return false
      }

      const state = useWorkflowBuilderStore.getState()
      const name = meta?.name != null ? String(meta.name).trim() : state.workflowName
      const description =
        meta?.description != null ? String(meta.description) : state.workflowDescription || ''
      const favorite =
        meta?.isFavorite != null ? Boolean(meta.isFavorite) : Boolean(state.isFavorite)
      const nextScope = meta
        ? meta.workflowScope === 'organization_default' || meta.workflowScope === 'global'
          ? meta.workflowScope
          : null
        : workflowScope
      const isScoped = nextScope === 'organization_default' || nextScope === 'global'
      const isActive =
        meta?.status != null
          ? meta.status === 'active'
          : publish
            ? true
            : state.isActive

      if (meta) {
        setWorkflowName(name)
        setWorkflowDescription(description)
        setIsFavorite(favorite)
        setIsActive(isActive)
      }

      const { ok, payload, warnings, error } = graphToWorkflowPayload({
        workflowName: name,
        workflowDescription: description,
        isFavorite: favorite,
        nodes: state.nodes,
        edges: state.edges,
        isActive,
        locationID: isScoped ? null : getEffectiveBranch() || null,
        // Only send scope on create — updates use PATCH /scope separately.
        workflowScope: state.workflowId ? null : nextScope,
      })

      if (!ok) {
        setSaving(false)
        setSaveStatus('unsaved')
        toast.error(error)
        return false
      }

      const existingId = state.workflowId
      const res = existingId
        ? await api.patch(`/api/workflow/${existingId}`, payload)
        : await api.post('/api/workflow/', payload)

      if (res?.success && existingId && nextScope !== workflowScope) {
        const scopeRes = await api.patch(`/api/workflow/${existingId}/scope`, {
          workflowScope: nextScope,
        })
        if (!scopeRes?.success) {
          setSaving(false)
          setSaveStatus('unsaved')
          toast.error(scopeRes?.error || 'Saved workflow but failed to update scope.')
          return false
        }
      }

      setSaving(false)

      if (res?.success) {
        const saved = res.data
        const savedScope =
          saved?.workflowScope === 'organization_default' || saved?.workflowScope === 'global'
            ? saved.workflowScope
            : nextScope
        setWorkflowScope(savedScope ?? null)
        const newId = saved?._id || saved?.id || existingId
        if (newId && newId !== existingId) {
          setWorkflowId(newId)
          const url = new URL(window.location.href)
          url.searchParams.set('id', newId)
          window.history.replaceState({}, '', url)
        }
        setIsActive(isActive)
        setSaveStatus('saved')
        ;(warnings || []).forEach((w) => toast.warning(w))
        toast.success(
          publish ? 'Workflow published' : existingId ? 'Workflow updated' : 'Workflow created'
        )
        return true
      }

      setSaveStatus('unsaved')
      toast.error(res?.error || 'Failed to save workflow.')
      return false
    },
    [
      readOnly,
      workflowScope,
      setIsActive,
      setIsFavorite,
      setSaveStatus,
      setWorkflowDescription,
      setWorkflowId,
      setWorkflowName,
    ]
  )

  const handleSave = useCallback(() => persist({ publish: false }), [persist])
  const handlePublishClick = useCallback(() => setPublishOpen(true), [])
  const handlePublishConfirm = useCallback(
    async (meta) => {
      const ok = await persist({ publish: true, meta })
      if (ok) setPublishOpen(false)
    },
    [persist]
  )

  return (
    <div className="flex h-[calc(100vh-5.5rem)] min-h-[560px] flex-col overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_8px_30px_rgba(15,23,42,0.06)] md:h-[calc(100vh-6rem)]">
      <WorkflowBuilderHeader
        onSave={handleSave}
        onPublish={handlePublishClick}
        saving={saving}
        readOnly={readOnly}
      />
      <PublishWorkflowDialog
        open={publishOpen}
        onClose={() => !saving && setPublishOpen(false)}
        onConfirm={handlePublishConfirm}
        busy={saving}
        allowMarkDefault={canManageDefaultWorkflows()}
        initialValues={{
          name: workflowName,
          description: workflowDescription,
          status: isActive ? 'active' : 'inactive',
          isFavorite,
          workflowScope,
        }}
      />
      <WorkflowStepGuide
        activeCategory={guidedCategory}
        onSelectCategory={setGuidedCategory}
      />

      {readOnly ? (
        <div className="border-b border-violet-500/30 bg-violet-500/10 px-4 py-2 text-[12px] text-violet-800 dark:text-violet-200">
          This is a shared{' '}
          {workflowScope === 'global' ? 'global' : 'organisation default'} template. Duplicate it
          from the workflows list to customize for your location.
        </div>
      ) : null}

      {loadError && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-[12px] text-destructive">
          {loadError}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        {loading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 backdrop-blur-sm">
            <span className="inline-flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading workflow…
            </span>
          </div>
        )}
        <WorkflowBuilderSidebar />
        <WorkflowBuilderCanvas />
        <WorkflowBuilderPropertiesPanel />
      </div>
    </div>
  )
}
