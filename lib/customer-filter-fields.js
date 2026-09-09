import { formatFieldDisplayValue } from '@/lib/dynamic-list-normalize'
import { getLeadReasonOptions } from '@/lib/lead-filter-fields'
import {
  ALL_CUSTOMER_FILTER_FIELDS,
  CUSTOMER_FILTER_GROUPS,
  FILTER_OPERATORS,
  conditionHasValue,
  getCustomerFilterFieldDef,
  getDefaultOperatorForCustomerField,
  getOperatorsForCustomerFilterField,
  isValuelessOperator,
  normalizeFilterConditionValue,
  serializeCustomerFilterConditionForApi,
  usesMultiValueOperator,
} from '@/lib/customer-list-filter-catalog'
import {
  stripSpendRankingConditions,
  syncCustomerSpendRanking,
} from '@/lib/customer-page-filters'

export const CUSTOMER_CONDITION_FIELDS = ALL_CUSTOMER_FILTER_FIELDS.map(({ value, label }) => ({
  value,
  label,
}))

export const CUSTOMER_CONDITION_OPERATORS = FILTER_OPERATORS

export function getConditionFieldDef(field) {
  if (String(field || '').startsWith('customFields.')) {
    return getCustomerFilterFieldDef('customFields')
  }
  return getCustomerFilterFieldDef(field)
}

export function getOperatorsForField(field) {
  return getOperatorsForCustomerFilterField(field)
}

export function normalizeConditionValue(operator, value) {
  return normalizeFilterConditionValue(operator, value)
}

export function getFieldValueOptions(field, context = {}) {
  const {
    locations = [],
    teachers = [],
    tags = [],
    memberships = [],
    packages = [],
    leadReasons = [],
  } = context
  const def = getConditionFieldDef(field)
  if (!def) return null

  if (def.optionsKey === 'locations' || field === 'locationID') {
    return locations.map((loc) => ({ value: loc._id, label: loc.name || loc._id }))
  }
  if (def.optionsKey === 'teachers' || field === 'enrollment.teacherID') {
    return teachers.map((t) => ({ value: t._id, label: t.name || t._id }))
  }
  if (def.optionsKey === 'reason' || field === 'reason') {
    return getLeadReasonOptions(leadReasons)
  }
  if (def.optionsKey === 'tags' || field === 'tags') {
    return (tags || []).map((tag) => ({
      value: typeof tag === 'string' ? tag : tag.name || tag._id,
      label: typeof tag === 'string' ? tag : tag.name || tag._id,
    }))
  }
  if (def.optionsKey === 'memberships' || field === 'membership.membershipName') {
    return memberships.map((m) => ({ value: m.name || m._id, label: m.name || m._id }))
  }
  if (def.optionsKey === 'packages' || field === 'package.packageID') {
    return packages.map((p) => ({ value: p._id, label: p.packageName || p._id }))
  }
  if (def.staticOptions) {
    return def.staticOptions.map((opt) =>
      typeof opt === 'string'
        ? { value: opt, label: formatFieldDisplayValue(opt) }
        : {
            value: opt.value,
            label: opt.label || formatFieldDisplayValue(opt.value),
          },
    )
  }
  return null
}

export function formatConditionDisplayValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((v) => formatFieldDisplayValue(String(v ?? '')))
      .filter(Boolean)
      .join(', ')
  }
  if (value && typeof value === 'object' && 'key' in value) {
    return `${value.key}: ${value.value}`
  }
  return formatFieldDisplayValue(String(value ?? ''))
}

export function getValidConditions(conditions = []) {
  if (!Array.isArray(conditions)) return []
  return conditions.filter((condition) => {
    if (!condition?.field) return false
    if (conditionHasValue(condition)) return true
    if (isValuelessOperator(condition?.operator || 'eq')) return true
    return false
  })
}

/** Conditions sent to the customer list API (excludes UI-only spend ranking). */
export function getApiCustomerConditions(conditions = []) {
  return stripSpendRankingConditions(getValidConditions(conditions))
}

function serializeConditionForApi(condition) {
  return serializeCustomerFilterConditionForApi(condition)
}

function buildConditionGroupsPayload(conditions = [], groupLogics = {}, globalLogic = 'AND') {
  const valid = getApiCustomerConditions(conditions)
  if (valid.length === 0) return null

  const byGroup = new Map()
  for (const condition of valid) {
    const groupId = condition.groupId || 'ungrouped'
    if (!byGroup.has(groupId)) byGroup.set(groupId, [])
    byGroup.get(groupId).push(serializeConditionForApi(condition))
  }

  const flatConditions = Array.from(byGroup.values()).flat()

  if (byGroup.size <= 1 && Object.keys(groupLogics || {}).length === 0) {
    return {
      conditionLogic: globalLogic === 'OR' ? 'OR' : 'AND',
      conditions: flatConditions,
    }
  }

  const groups = Array.from(byGroup.entries()).map(([groupId, groupConditions]) => ({
    id: groupId,
    logic: groupLogics?.[groupId] === 'OR' ? 'OR' : 'AND',
    conditions: groupConditions,
  }))

  return {
    conditionLogic: globalLogic === 'OR' ? 'OR' : 'AND',
    conditions: flatConditions,
    conditionGroups: groups,
  }
}

export function buildCustomerQueryParams({ page, limit, filters = {} }) {
  const synced = syncCustomerSpendRanking(filters)
  const params = new URLSearchParams()
  if (page) params.set('page', String(page))
  if (limit) params.set('limit', String(limit))

  const search = String(synced?.search ?? '').trim()
  if (search) params.set('search', search)
  if (synced?.teacherID) params.set('teacherID', synced.teacherID)

  const conditions = Array.isArray(synced?.conditions) ? synced.conditions : []
  const payload = buildConditionGroupsPayload(
    conditions,
    synced?.groupLogics || {},
    synced?.conditionLogic || 'AND',
  )

  if (payload) {
    params.set('conditionLogic', payload.conditionLogic)
    params.set('conditions', JSON.stringify(payload.conditions))
    if (payload.conditionGroups?.length) {
      params.set('conditionGroups', JSON.stringify(payload.conditionGroups))
    }
  }

  const sortBy = String(synced?.sortBy || '').trim()
  const sortOrder = String(synced?.sortOrder || '').trim()
  if (sortBy) params.set('sortBy', sortBy)
  if (sortOrder === 'asc' || sortOrder === 'desc') params.set('sortOrder', sortOrder)

  return params
}

export function filtersToConditionsForForm(filters = {}) {
  if (!Array.isArray(filters?.conditions)) return []
  return getValidConditions(filters.conditions).map((c) => ({
    ...serializeConditionForApi(c),
    ...(c.groupId ? { groupId: c.groupId } : {}),
    ...(c.id ? { id: c.id } : {}),
  }))
}

export {
  CUSTOMER_FILTER_GROUPS,
  conditionHasValue,
  getDefaultOperatorForCustomerField as getDefaultOperatorForField,
  usesMultiValueOperator,
}
