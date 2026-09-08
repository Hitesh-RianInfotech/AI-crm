'use client'

/** Step types accepted by the workflow API. */
export const WORKFLOW_STEP_TYPES = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'aiCall', label: 'AI Call' },
]

export const WORKFLOW_EMAIL_TYPES = [
  { value: 'message', label: 'Plain text' },
  { value: 'template', label: 'HTML template' },
]

export const WORKFLOW_SMS_CONTENT_TYPES = [
  { value: 'custom', label: 'Custom message' },
  { value: 'template', label: 'SMS template' },
]

export const WORKFLOW_EVENT_OPTIONS = [
  { value: 'non', label: 'None' },
  { value: 'form_submission', label: 'Form submission' },
  { value: 'lead_updated', label: 'Lead updated' },
  { value: 'lead_moved_stage', label: 'Lead moved stage' },
  { value: 'custom_event', label: 'Custom event' },
]

/** Hours 0–23 for step scheduling (local time on the selected day). */
export const WORKFLOW_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: `${String(hour).padStart(2, '0')}:00`,
}))

/** Minutes 0–59 for finer scheduling within the hour. */
export const WORKFLOW_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => ({
  value: minute,
  label: String(minute).padStart(2, '0'),
}))

const VALID_STEP_TYPES = new Set(WORKFLOW_STEP_TYPES.map((t) => t.value))

/** Map legacy UI value and unknown types to API-safe values. */
export function normalizeStepTypeForApi(type) {
  const t = String(type ?? '').trim()
  if (t === 'call' || t === 'humanCall') return 'aiCall'
  if (VALID_STEP_TYPES.has(t)) return t
  return 'sms'
}

export function normalizeStepTypeFromApi(type) {
  return normalizeStepTypeForApi(type)
}

export function isCallStepType(type) {
  return type === 'call' || type === 'aiCall' || type === 'humanCall'
}

export function coerceWorkflowDay(day) {
  const n = day === 0 || day === '0' ? 0 : Number(day)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function coerceWorkflowHour(hour) {
  const n = hour === 0 || hour === '0' ? 0 : Number(hour)
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : 0
}

export function coerceWorkflowMinute(minute) {
  const n = minute === 0 || minute === '0' ? 0 : Number(minute)
  return Number.isFinite(n) && n >= 0 && n <= 59 ? n : 0
}

/**
 * Backend may return steps as:
 * - Step[] (flat)
 * - Step[][] (grouped by day — multiple steps per inner array)
 *
 * We normalize to Step[] for counts / legacy use.
 */
export function createWorkflowStepUiId(prefix = 'step') {
  const rand = Math.random().toString(36).slice(2, 9)
  return `${prefix}-${Date.now().toString(36)}-${rand}`
}

/** Ensure every step has a stable _uiId (required for drag-and-drop and expand state). */
export function ensureStepsByDayUiIds(stepsByDay) {
  if (!Array.isArray(stepsByDay)) return [[createEmptyWorkflowStep(0)]]
  return stepsByDay.map((daySteps, dayIdx) => {
    if (!Array.isArray(daySteps) || daySteps.length === 0) {
      return [createEmptyWorkflowStep(dayIdx)]
    }
    return daySteps.map((step, stepIdx) => {
      if (step?._uiId) return step
      return { ...step, _uiId: createWorkflowStepUiId(`d${dayIdx}-s${stepIdx}`) }
    })
  })
}

export function flattenWorkflowSteps(steps) {
  if (!Array.isArray(steps)) return []
  if (steps.length === 0) return []

  const isGrouped = Array.isArray(steps[0])
  const flat = isGrouped ? steps.flat(1) : steps
  return flat.filter(Boolean)
}

export function normalizeWorkflowStepFromApi(step, idx = 0) {
  const type = normalizeStepTypeFromApi(step?.type)
  const base = {
    _uiId: step?._uiId || createWorkflowStepUiId(`step-${idx}`),
    type,
    description: String(step?.description ?? ''),
    day: coerceWorkflowDay(step?.day),
    hour: coerceWorkflowHour(step?.hour),
    minute: coerceWorkflowMinute(step?.minute),
  }

  if (type === 'email') {
    const emailType = step?.emailType === 'template' ? 'template' : 'message'
    return {
      ...base,
      emailType,
      subject: String(step?.subject ?? step?.emailTemplateSubject ?? ''),
      script: String(step?.script ?? ''),
      htmlBody: String(step?.htmlBody ?? ''),
      emailTemplateId: String(step?.emailTemplateId ?? ''),
      emailTemplateSubject: String(step?.emailTemplateSubject ?? ''),
    }
  }

  if (type === 'sms') {
    return {
      ...base,
      script: String(step?.script ?? ''),
      smsContentType: step?.smsContentType === 'template' ? 'template' : 'custom',
      smsTemplateId: String(step?.smsTemplateId ?? ''),
      smsTemplateName: String(step?.smsTemplateName ?? ''),
    }
  }

  return base
}

export function normalizeWorkflowStepForApi(step, orderIndex = 0) {
  const type = normalizeStepTypeForApi(step?.type)
  const orderNum = Number(orderIndex)
  const base = {
    type,
    description: step?.description ?? '',
    order: Number.isFinite(orderNum) && orderNum > 0 ? orderNum : 1,
    day: coerceWorkflowDay(step?.day),
    hour: coerceWorkflowHour(step?.hour),
    minute: coerceWorkflowMinute(step?.minute),
    knowledgeBaseIDes: Array.isArray(step?.knowledgeBaseIDes) ? step.knowledgeBaseIDes : [],
  }

  if (type === 'email') {
    const emailType = step?.emailType === 'template' ? 'template' : 'message'
    const emailBase = {
      ...base,
      emailType,
      subject: String(step?.subject ?? ''),
    }
    if (emailType === 'template') {
      return { ...emailBase, htmlBody: String(step?.htmlBody ?? '') }
    }
    return { ...emailBase, script: String(step?.script ?? '') }
  }

  if (type === 'sms') {
    return { ...base, script: String(step?.script ?? '') }
  }

  return base
}

/** Convert API steps (flat or grouped) into Step[][] grouped by day. */
export function stepsByDayFromApi(steps) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return [[createEmptyWorkflowStep(0)]]
  }

  const isGrouped = Array.isArray(steps[0])
  if (isGrouped) {
    const groups = steps
      .filter((g) => Array.isArray(g) && g.length > 0)
      .map((daySteps, groupIdx) => {
        const day = coerceWorkflowDay(daySteps[0]?.day ?? groupIdx)
        return daySteps.map((s, idx) => normalizeWorkflowStepFromApi({ ...s, day }, idx))
      })
    return ensureStepsByDayUiIds(
      sortStepsByDay(groups.length > 0 ? groups : [[createEmptyWorkflowStep(0)]])
    )
  }

  const flat = steps.map((s, idx) => normalizeWorkflowStepFromApi(s, idx))
  const byDay = new Map()
  for (const step of flat) {
    const d = step.day
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d).push(step)
  }
  const days = [...byDay.keys()].sort((a, b) => a - b)
  const groups = days.map((d) => byDay.get(d))
  return ensureStepsByDayUiIds(groups.length > 0 ? groups : [[createEmptyWorkflowStep(0)]])
}

/** API expects steps grouped by day: Step[][]. Each inner array = all steps on that day. */
export function groupWorkflowStepsForApi(stepsInput) {
  const groups = Array.isArray(stepsInput?.[0])
    ? stepsInput
    : stepsByDayFromApi(stepsInput)

  return sortStepsByDay(groups)
    .filter((daySteps) => Array.isArray(daySteps) && daySteps.length > 0)
    .map((daySteps) => {
      const day = coerceWorkflowDay(daySteps[0]?.day)
      return daySteps.map((s, idx) => normalizeWorkflowStepForApi({ ...s, day }, idx + 1))
    })
}

export function flattenStepsFromGroups(stepsByDay) {
  if (!Array.isArray(stepsByDay)) return []
  return stepsByDay.flat(1).filter(Boolean)
}

export function normalizeWorkflowFormIdsFromApi(workflow) {
  const raw = workflow?.formID ?? workflow?.formIDs
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .map((id) => (typeof id === 'object' ? String(id?._id || id?.id || '') : String(id)))
      .filter(Boolean)
  }
  if (typeof raw === 'object') return [String(raw._id || raw.id || '')].filter(Boolean)
  return [String(raw)].filter(Boolean)
}

export function normalizeIsGenericFormFromApi(workflow) {
  const v = workflow?.isGenericForm
  return v === true || v === 'true'
}

export function normalizeWorkflowReasonFromApi(workflow) {
  return String(workflow?.reason ?? '')
}

export function normalizeWorkflowListIdFromApi(workflow) {
  const raw = workflow?.listID
  if (!raw) return ''
  if (typeof raw === 'object') return String(raw?._id || raw?.id || '')
  return String(raw)
}

export function normalizeWorkflowListNameFromApi(workflow) {
  const raw = workflow?.listID
  if (!raw || typeof raw !== 'object') return ''
  return String(raw?.name ?? '')
}

/** @deprecated use normalizeWorkflowFormIdsFromApi */
export function normalizeWorkflowFormIdFromApi(workflow) {
  const ids = normalizeWorkflowFormIdsFromApi(workflow)
  return ids[0] ?? ''
}

export function normalizeWorkflowFromApi(workflow) {
  if (!workflow || typeof workflow !== 'object') return null

  const stepsByDay = stepsByDayFromApi(workflow.steps)
  const formIDs = normalizeWorkflowFormIdsFromApi(workflow)
  const listID = normalizeWorkflowListIdFromApi(workflow)

  return {
    ...workflow,
    formID: formIDs,
    formIDs,
    listID,
    listName: normalizeWorkflowListNameFromApi(workflow),
    isGenericForm: normalizeIsGenericFormFromApi(workflow),
    reason: normalizeWorkflowReasonFromApi(workflow),
    entityType: workflow.entityType === 'customer' ? 'customer' : 'lead',
    audienceMode:
      workflow.audienceMode === 'all' || workflow.audienceMode === 'list'
        ? workflow.audienceMode
        : listID
          ? 'list'
          : workflow.baseCondition
            ? 'all'
            : '',
    baseCondition:
      workflow.baseCondition && typeof workflow.baseCondition === 'object'
        ? workflow.baseCondition
        : null,
    additionalFilter:
      workflow.additionalFilter && typeof workflow.additionalFilter === 'object'
        ? workflow.additionalFilter
        : null,
    exitLogic:
      workflow.exitLogic && typeof workflow.exitLogic === 'object' ? workflow.exitLogic : null,
    isFavorite: Boolean(workflow.isFavorite),
    description: String(workflow.description ?? ''),
    stepsByDay,
    steps: flattenStepsFromGroups(stepsByDay),
  }
}

export function normalizeWorkflowForPatch(workflow) {
  const stepsInput = workflow?.stepsByDay ?? workflow?.steps
  const listID = normalizeWorkflowListIdFromApi(workflow)
  const audienceMode =
    workflow?.audienceMode === 'all' || workflow?.audienceMode === 'list'
      ? workflow.audienceMode
      : listID
        ? 'list'
        : ''
  const hasContactAudience = audienceMode === 'all' || audienceMode === 'list'
  const isListBased = Boolean(listID) || hasContactAudience

  const payload = {
    name: String(workflow?.name ?? ''),
    description: String(workflow?.description ?? ''),
    steps: groupWorkflowStepsForApi(stepsInput),
    isFavorite: Boolean(workflow?.isFavorite),
  }

  const exitLogic =
    workflow?.exitLogic && typeof workflow.exitLogic === 'object' ? workflow.exitLogic : null
  if (exitLogic) {
    const exitRuleStages = Array.isArray(exitLogic.exitRuleStages)
      ? exitLogic.exitRuleStages.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 1)
      : []
    if (exitRuleStages.length) {
      payload.exitLogic = {
        successGoalStages: [],
        exitRuleStages,
      }
    } else {
      payload.exitLogic = null
    }
  } else if (workflow && 'exitLogic' in workflow) {
    payload.exitLogic = null
  }

  if (isListBased) {
    if (hasContactAudience) {
      payload.entityType = workflow?.entityType === 'customer' ? 'customer' : 'lead'
      payload.audienceMode = audienceMode
      payload.listID = audienceMode === 'list' ? listID || null : null
      if (workflow?.baseCondition && typeof workflow.baseCondition === 'object') {
        payload.baseCondition = workflow.baseCondition
      }
      if (workflow?.additionalFilter && typeof workflow.additionalFilter === 'object') {
        payload.additionalFilter = workflow.additionalFilter
      } else {
        payload.additionalFilter = null
      }
    } else {
      payload.listID = listID
    }
    const reason = String(workflow?.reason ?? '').trim()
    payload.reason = reason || null
    payload.event = 'non'
    payload.formID = []
    payload.isGenericForm = 'false'
    return payload
  }

  const isGenericForm = Boolean(workflow?.isGenericForm)
  const formIDs = isGenericForm ? [] : normalizeWorkflowFormIdsFromApi(workflow)
  const event = String(workflow?.event ?? '')

  payload.event = event
  payload.formID = formIDs
  payload.isGenericForm = isGenericForm ? 'true' : 'false'
  payload.listID = null

  if (isWorkflowEventFormSubmission(event)) {
    const reason = String(workflow?.reason ?? '').trim()
    payload.reason = reason || null
  } else {
    payload.reason = null
  }

  return payload
}

export function buildDuplicateWorkflowName(name) {
  const base = String(name ?? '').trim() || 'Workflow'
  const copyName = `Copy of ${base}`
  return copyName.length > 120 ? `${copyName.slice(0, 117)}…` : copyName
}

/** Build POST body for duplicating a workflow (saved as inactive to avoid trigger conflicts). */
export function buildDuplicateWorkflowPayload(workflow) {
  const normalized = normalizeWorkflowFromApi(workflow)
  if (!normalized) return null

  const payload = normalizeWorkflowForPatch({
    ...normalized,
    name: buildDuplicateWorkflowName(normalized.name),
  })

  // Duplicate into the currently selected branch when available.
  let locationID = null
  try {
    // Lazy import path avoided — callers in client components pass branch via api header;
    // still stamp locationID when the source had one so duplicates stay location-scoped.
    locationID = normalized.locationID || null
  } catch {
    locationID = null
  }

  return {
    ...payload,
    status: 'inactive',
    workflowScope: null,
    ...(locationID ? { locationID: String(locationID) } : {}),
  }
}

export function createEmptyWorkflowStep(day = 0) {
  return {
    _uiId: createWorkflowStepUiId(),
    type: 'sms',
    description: '',
    day: coerceWorkflowDay(day),
    hour: 0,
    minute: 0,
    script: '',
    emailType: 'message',
    subject: '',
    htmlBody: '',
    emailTemplateId: '',
    emailTemplateSubject: '',
    smsContentType: 'custom',
    smsTemplateId: '',
    smsTemplateName: '',
  }
}

export function createInitialStepsByDay() {
  return [[createEmptyWorkflowStep(0)]]
}

export function createEmptyDayRow(day) {
  return [createEmptyWorkflowStep(day)]
}

export function getDayFromStepGroup(daySteps) {
  return coerceWorkflowDay(daySteps?.[0]?.day)
}

export function sortStepsByDay(stepsByDay) {
  if (!Array.isArray(stepsByDay)) return []
  return [...stepsByDay]
    .filter((g) => Array.isArray(g) && g.length > 0)
    .sort((a, b) => getDayFromStepGroup(a) - getDayFromStepGroup(b))
}

export function getWorkflowDayNumbers(stepsByDay) {
  return sortStepsByDay(stepsByDay).map(getDayFromStepGroup)
}

export function workflowDayExists(stepsByDay, day) {
  const target = coerceWorkflowDay(day)
  return getWorkflowDayNumbers(stepsByDay).includes(target)
}

export function nextWorkflowDay(stepsByDay) {
  const days = getWorkflowDayNumbers(stepsByDay)
  if (days.length === 0) return 0
  return Math.max(...days) + 1
}

export function insertWorkflowDay(stepsByDay, day) {
  const targetDay = coerceWorkflowDay(day)
  if (workflowDayExists(stepsByDay, targetDay)) {
    return { ok: false, error: `Day ${targetDay} already exists in this workflow.` }
  }
  return {
    ok: true,
    stepsByDay: sortStepsByDay([...stepsByDay, [createEmptyWorkflowStep(targetDay)]]),
  }
}

export function isWorkflowEventFormSubmission(event) {
  return String(event ?? '').trim() === 'form_submission'
}

export function validateWorkflowMeta({ name, event, formIDs, isGenericForm, reason }) {
  if (!String(name ?? '').trim()) return false
  if (!String(event ?? '').trim()) return false
  if (isWorkflowEventFormSubmission(event) && !isGenericForm) {
    if (!Array.isArray(formIDs) || formIDs.length === 0) return false
  }
  return true
}

export function validateWorkflowStep(step) {
  if (!step?.type) return false
  if (!Number.isFinite(Number(step.day))) return false
  if (!Number.isFinite(Number(step.hour))) return false
  if (!Number.isFinite(Number(step.minute))) return false
  return true
}

export function validateWorkflowSteps(stepsByDay) {
  const flat = flattenStepsFromGroups(stepsByDay)
  if (flat.length === 0) return false
  return flat.every((s) => validateWorkflowStep(s))
}

/** Form templates from GET /api/formBuilder */
export function extractFormTemplatesList(result) {
  const payload = result?.data
  return Array.isArray(payload) ? payload : []
}

/** Lead reasons from GET /api/lead-reasons (same shape as email builder). */
export function extractLeadReasonsList(result) {
  const payload = result?.data
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.reasons)
        ? payload.reasons
        : Array.isArray(payload?.data?.reasons)
          ? payload.data.reasons
          : []
  return Array.isArray(list) ? list : []
}
