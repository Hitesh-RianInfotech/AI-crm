import { formatFieldDisplayValue } from '@/lib/dynamic-list-normalize'
import {
  OPERATOR_LABEL_MAP,
  isValuelessOperator,
} from '@/lib/dynamic-list-filter-catalog'
import {
  getValidConditions,
  getConditionFieldDef,
  getFieldValueOptions,
} from '@/lib/customer-filter-fields'
import {
  CUSTOMER_SORT_OPTIONS,
  customerSortPresetValue,
  applyCustomerSortPreset,
  isSpendRankingCondition,
  isCreditsRankingCondition,
  isUiRankingCondition,
  stripUiRankingConditions,
  syncCustomerSpendRanking,
} from '@/lib/customer-page-filters'

function formatConditionValue(condition, context = {}) {
  const op = condition.operator || 'eq'
  if (isValuelessOperator(op)) return ''
  const value = condition.value
  const options = getFieldValueOptions(condition.field, context) || []
  const labelFor = (raw) => {
    const hit = options.find((o) => String(o.value) === String(raw))
    return hit?.label || formatFieldDisplayValue(String(raw ?? ''))
  }
  if (Array.isArray(value)) return value.map(labelFor).join(', ')
  if (value && typeof value === 'object') {
    return `${value.from ?? ''} – ${value.to ?? ''}`
  }
  return labelFor(value)
}

function summarizeCustomerCondition(condition, context = {}) {
  const def = getConditionFieldDef(condition.field)
  const fieldLabel = def?.label || formatFieldDisplayValue(condition.field)
  const op = condition.operator || 'eq'
  if (isSpendRankingCondition(condition)) {
    return `Spend ranking: ${formatConditionValue(condition, context) || condition.value}`
  }
  if (isCreditsRankingCondition(condition)) {
    return `Credits ranking: ${formatConditionValue(condition, context) || condition.value}`
  }
  if (isValuelessOperator(op)) {
    return `${fieldLabel}: ${OPERATOR_LABEL_MAP[op] || op}`
  }
  const opLabel = (() => {
    if (def?.inputType === 'date' && op === 'eq') return 'on'
    if (def?.inputType === 'date' && op === 'gt') return 'after'
    if (def?.inputType === 'date' && op === 'lt') return 'before'
    return (OPERATOR_LABEL_MAP[op] || op).toLowerCase()
  })()
  if (op === 'between') {
    return `${fieldLabel}: ${formatConditionValue(condition, context)}`
  }
  return `${fieldLabel} ${opLabel} ${formatConditionValue(condition, context)}`.trim()
}

export function getActiveCustomerFilterChips(
  filters = {},
  {
    teachers = [],
    locations = [],
    tags = [],
    memberships = [],
    packages = [],
    leadReasons = [],
    search = '',
  } = {},
) {
  const chips = []
  const context = { teachers, locations, tags, memberships, packages, leadReasons }
  const q = String(search ?? filters.search ?? '').trim()
  if (q) {
    chips.push({
      id: 'search',
      label: `Search: ${q}`,
      remove: { type: 'search' },
    })
  }
  if (filters.teacherID) {
    const teacher = teachers.find((t) => String(t._id) === String(filters.teacherID))
    chips.push({
      id: 'teacherID',
      label: `Teacher: ${teacher?.name || filters.teacherID}`,
      remove: { type: 'teacherID' },
    })
  }

  const preset = customerSortPresetValue(filters)
  if (preset === 'most_spend' || preset === 'least_spend') {
    const opt = CUSTOMER_SORT_OPTIONS.find((o) => o.value === preset)
    chips.push({
      id: 'spend-sort',
      label: opt?.label || 'Spend ranking',
      remove: { type: 'spendRanking' },
    })
  }
  if (preset === 'most_credits' || preset === 'least_credits') {
    const opt = CUSTOMER_SORT_OPTIONS.find((o) => o.value === preset)
    chips.push({
      id: 'credits-sort',
      label: opt?.label || 'Credits ranking',
      remove: { type: 'creditsRanking' },
    })
  }

  for (const condition of getValidConditions(filters.conditions)) {
    if (isUiRankingCondition(condition)) continue
    chips.push({
      id: condition.id || `condition:${condition.field}:${condition.operator}`,
      label: summarizeCustomerCondition(condition, context),
      remove: { type: 'condition', id: condition.id, field: condition.field },
    })
  }

  return chips
}

export function removeCustomerFilterChip(filters = {}, chip, { clearSearch } = {}) {
  const action = chip?.remove
  if (!action) return filters

  if (action.type === 'search') {
    clearSearch?.()
    return { ...filters, search: '' }
  }
  if (action.type === 'teacherID') {
    return { ...filters, teacherID: '' }
  }
  if (action.type === 'spendRanking' || action.type === 'creditsRanking') {
    return syncCustomerSpendRanking({
      ...applyCustomerSortPreset(filters, 'newest'),
      conditions: stripUiRankingConditions(filters.conditions),
    })
  }
  if (action.type === 'condition') {
    const nextConditions = (filters.conditions || []).filter((c) => {
      if (action.id && c.id) return c.id !== action.id
      return c.field !== action.field
    })
    return syncCustomerSpendRanking({ ...filters, conditions: nextConditions })
  }
  return filters
}

// Re-export sync helpers used by query builders / page apply handlers.
export {
  syncCustomerSpendRanking,
  stripSpendRankingConditions,
  stripUiRankingConditions,
  isSpendRankingCondition,
  isCreditsRankingCondition,
  isUiRankingCondition,
  SPEND_RANKING_FIELD,
  CREDITS_RANKING_FIELD,
} from '@/lib/customer-page-filters'
