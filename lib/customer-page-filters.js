import { conditionHasValue, isValuelessOperator } from '@/lib/customer-list-filter-catalog'

export const SPEND_RANKING_FIELD = 'payment.spendRanking'

export const EMPTY_CUSTOMER_FILTERS = {
  search: '',
  teacherID: '',
  conditionLogic: 'AND',
  conditions: [],
  groupLogics: {},
  enabledGroups: {},
  sortBy: 'createdAt',
  sortOrder: 'desc',
}

/** Preset sort options for the customers list / spend ranking. */
export const CUSTOMER_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'most_spend', label: 'Most spend', sortBy: 'payment.totalSpend', sortOrder: 'desc' },
  { value: 'least_spend', label: 'Least spend', sortBy: 'payment.totalSpend', sortOrder: 'asc' },
]

export function isSpendRankingCondition(condition) {
  return condition?.field === SPEND_RANKING_FIELD
}

export function spendRankingToSort(value) {
  if (value === 'most') return { sortBy: 'payment.totalSpend', sortOrder: 'desc' }
  if (value === 'least') return { sortBy: 'payment.totalSpend', sortOrder: 'asc' }
  return null
}

export function sortToSpendRankingValue(sortBy, sortOrder) {
  if (sortBy !== 'payment.totalSpend') return null
  return sortOrder === 'asc' ? 'least' : 'most'
}

export function stripSpendRankingConditions(conditions = []) {
  return (Array.isArray(conditions) ? conditions : []).filter((c) => !isSpendRankingCondition(c))
}

/**
 * Keep list sort and the Payments “Spend ranking” filter field in sync.
 * Spend ranking is UI-only — never sent as an API condition.
 */
export function syncCustomerSpendRanking(filters = {}) {
  const conditions = Array.isArray(filters.conditions) ? filters.conditions : []
  const others = stripSpendRankingConditions(conditions)
  const ranking = conditions.find(
    (c) => isSpendRankingCondition(c) && String(c.value ?? '').trim() !== '',
  )
  const fromCondition = spendRankingToSort(ranking?.value)
  if (fromCondition) {
    return {
      ...filters,
      ...fromCondition,
      conditions: [
        ...others,
        {
          id: ranking.id || 'spend-ranking',
          field: SPEND_RANKING_FIELD,
          operator: 'eq',
          value: ranking.value,
          groupId: ranking.groupId || 'payments',
        },
      ],
    }
  }

  const fromSort = sortToSpendRankingValue(filters.sortBy, filters.sortOrder)
  if (fromSort) {
    return {
      ...filters,
      conditions: [
        ...others,
        {
          id: 'spend-ranking',
          field: SPEND_RANKING_FIELD,
          operator: 'eq',
          value: fromSort,
          groupId: 'payments',
        },
      ],
    }
  }

  return {
    ...filters,
    conditions: others,
    sortBy: filters.sortBy || 'createdAt',
    sortOrder: filters.sortOrder === 'asc' ? 'asc' : 'desc',
  }
}

export function customerSortPresetValue(filters = {}) {
  const by = filters?.sortBy || 'createdAt'
  const order = filters?.sortOrder === 'asc' ? 'asc' : 'desc'
  const match = CUSTOMER_SORT_OPTIONS.find((o) => o.sortBy === by && o.sortOrder === order)
  return match?.value || 'newest'
}

export function applyCustomerSortPreset(filters, presetValue) {
  const preset = CUSTOMER_SORT_OPTIONS.find((o) => o.value === presetValue) || CUSTOMER_SORT_OPTIONS[0]
  return syncCustomerSpendRanking({
    ...filters,
    sortBy: preset.sortBy,
    sortOrder: preset.sortOrder,
  })
}

export function sanitizeCustomerFilters(filters) {
  return syncCustomerSpendRanking({
    ...filters,
    search: filters?.search ?? '',
    teacherID: filters?.teacherID ?? '',
    conditionLogic: filters?.conditionLogic === 'OR' ? 'OR' : 'AND',
    conditions: Array.isArray(filters?.conditions) ? filters.conditions : [],
    groupLogics:
      filters?.groupLogics && typeof filters.groupLogics === 'object' ? filters.groupLogics : {},
    enabledGroups:
      filters?.enabledGroups && typeof filters.enabledGroups === 'object'
        ? filters.enabledGroups
        : {},
    sortBy: filters?.sortBy || 'createdAt',
    sortOrder: filters?.sortOrder === 'asc' ? 'asc' : 'desc',
  })
}

export function hasActiveCustomerFilters(filters = {}) {
  if (String(filters?.search ?? '').trim()) return true
  if (String(filters?.teacherID ?? '').trim()) return true
  if (customerSortPresetValue(filters) !== 'newest') return true
  return (Array.isArray(filters?.conditions) ? filters.conditions : []).some((c) => {
    if (!c?.field || isSpendRankingCondition(c)) return false
    if (conditionHasValue(c)) return true
    return isValuelessOperator(c?.operator || 'eq')
  })
}

export function countAdvancedCustomerFilters(filters = {}) {
  return (Array.isArray(filters?.conditions) ? filters.conditions : []).filter((c) => {
    if (!c?.field || isSpendRankingCondition(c)) return false
    if (conditionHasValue(c)) return true
    return isValuelessOperator(c?.operator || 'eq')
  }).length
}
