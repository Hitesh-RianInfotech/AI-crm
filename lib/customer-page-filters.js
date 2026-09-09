import { conditionHasValue, isValuelessOperator } from '@/lib/customer-list-filter-catalog'

export const SPEND_RANKING_FIELD = 'payment.spendRanking'
export const CREDITS_RANKING_FIELD = 'credits.ranking'

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

/** Preset sort options for the customers list / spend & credits ranking. */
export const CUSTOMER_SORT_OPTIONS = [
  { value: 'newest', label: 'Newest', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'most_spend', label: 'Most spend', sortBy: 'payment.totalSpend', sortOrder: 'desc' },
  { value: 'least_spend', label: 'Least spend', sortBy: 'payment.totalSpend', sortOrder: 'asc' },
  { value: 'most_credits', label: 'Most credits', sortBy: 'credits', sortOrder: 'desc' },
  { value: 'least_credits', label: 'Least credits', sortBy: 'credits', sortOrder: 'asc' },
]

export function isSpendRankingCondition(condition) {
  return condition?.field === SPEND_RANKING_FIELD
}

export function isCreditsRankingCondition(condition) {
  return condition?.field === CREDITS_RANKING_FIELD
}

export function isUiRankingCondition(condition) {
  return isSpendRankingCondition(condition) || isCreditsRankingCondition(condition)
}

export function spendRankingToSort(value) {
  if (value === 'most') return { sortBy: 'payment.totalSpend', sortOrder: 'desc' }
  if (value === 'least') return { sortBy: 'payment.totalSpend', sortOrder: 'asc' }
  return null
}

export function creditsRankingToSort(value) {
  if (value === 'most') return { sortBy: 'credits', sortOrder: 'desc' }
  if (value === 'least') return { sortBy: 'credits', sortOrder: 'asc' }
  return null
}

export function sortToSpendRankingValue(sortBy, sortOrder) {
  if (sortBy !== 'payment.totalSpend') return null
  return sortOrder === 'asc' ? 'least' : 'most'
}

export function sortToCreditsRankingValue(sortBy, sortOrder) {
  if (sortBy !== 'credits') return null
  return sortOrder === 'asc' ? 'least' : 'most'
}

export function stripSpendRankingConditions(conditions = []) {
  return (Array.isArray(conditions) ? conditions : []).filter((c) => !isSpendRankingCondition(c))
}

export function stripUiRankingConditions(conditions = []) {
  return (Array.isArray(conditions) ? conditions : []).filter((c) => !isUiRankingCondition(c))
}

/**
 * Keep list sort and UI ranking filters (spend / credits) in sync.
 * Ranking fields are UI-only — never sent as API conditions.
 * If both ranking conditions are present, the last one in the list wins.
 */
export function syncCustomerSpendRanking(filters = {}) {
  const conditions = Array.isArray(filters.conditions) ? filters.conditions : []
  const others = stripUiRankingConditions(conditions)
  const rankings = conditions.filter(
    (c) => isUiRankingCondition(c) && String(c.value ?? '').trim() !== '',
  )
  const ranking = rankings[rankings.length - 1]

  if (isCreditsRankingCondition(ranking)) {
    const fromCondition = creditsRankingToSort(ranking.value)
    if (fromCondition) {
      return {
        ...filters,
        ...fromCondition,
        conditions: [
          ...others,
          {
            id: ranking.id || 'credits-ranking',
            field: CREDITS_RANKING_FIELD,
            operator: 'eq',
            value: ranking.value,
            groupId: ranking.groupId || 'customer_profile',
          },
        ],
      }
    }
  }

  if (isSpendRankingCondition(ranking)) {
    const fromCondition = spendRankingToSort(ranking.value)
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
  }

  const fromCreditsSort = sortToCreditsRankingValue(filters.sortBy, filters.sortOrder)
  if (fromCreditsSort) {
    return {
      ...filters,
      conditions: [
        ...others,
        {
          id: 'credits-ranking',
          field: CREDITS_RANKING_FIELD,
          operator: 'eq',
          value: fromCreditsSort,
          groupId: 'customer_profile',
        },
      ],
    }
  }

  const fromSpendSort = sortToSpendRankingValue(filters.sortBy, filters.sortOrder)
  if (fromSpendSort) {
    return {
      ...filters,
      conditions: [
        ...others,
        {
          id: 'spend-ranking',
          field: SPEND_RANKING_FIELD,
          operator: 'eq',
          value: fromSpendSort,
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
  // Strip ranking conditions first so sync derives them only from the new sort
  // (otherwise an old ranking condition wins and undoes the preset).
  return syncCustomerSpendRanking({
    ...filters,
    sortBy: preset.sortBy,
    sortOrder: preset.sortOrder,
    conditions: stripUiRankingConditions(filters.conditions),
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
    if (!c?.field || isUiRankingCondition(c)) return false
    if (conditionHasValue(c)) return true
    return isValuelessOperator(c?.operator || 'eq')
  })
}

export function countAdvancedCustomerFilters(filters = {}) {
  return (Array.isArray(filters?.conditions) ? filters.conditions : []).filter((c) => {
    if (!c?.field || isUiRankingCondition(c)) return false
    if (conditionHasValue(c)) return true
    return isValuelessOperator(c?.operator || 'eq')
  }).length
}
