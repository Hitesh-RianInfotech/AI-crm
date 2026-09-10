'use client'

import {
  FILTER_OPERATORS,
  isValuelessOperator,
  usesMultiValueOperator,
  isBetweenOperator,
} from '@/lib/dynamic-list-filter-catalog'

export function makeCatalogApi(FILTER_GROUPS) {
  const FIELD_MAP = Object.fromEntries(
    FILTER_GROUPS.flatMap((g) => g.fields.map((f) => [f.value, f]))
  )

  function getFilterFieldDef(field) {
    return FIELD_MAP[field] || null
  }

  function getOperatorsForFilterField(field) {
    const def = getFilterFieldDef(field)
    if (!def) return FILTER_OPERATORS.filter((o) => o.value === 'eq')
    return FILTER_OPERATORS.filter((o) => def.operators.includes(o.value)).map((o) => {
      if (def.inputType === 'date' && o.value === 'eq') {
        return { ...o, label: 'On' }
      }
      if (def.inputType === 'date' && o.value === 'gt') {
        return { ...o, label: 'After' }
      }
      if (def.inputType === 'date' && o.value === 'lt') {
        return { ...o, label: 'Before' }
      }
      return o
    })
  }

  function getDefaultOperatorForField(field) {
    const def = getFilterFieldDef(field)
    return def?.operators?.[0] || 'eq'
  }

  function emptyValueForOperator(operator) {
    if (isValuelessOperator(operator)) return true
    if (usesMultiValueOperator(operator)) return []
    if (isBetweenOperator(operator)) return { from: '', to: '' }
    return ''
  }

  function conditionHasValue(condition) {
    if (!condition?.field) return false
    const operator = condition.operator || 'eq'
    if (isValuelessOperator(operator)) return true
    const value = condition.value
    if (usesMultiValueOperator(operator)) {
      if (Array.isArray(value)) return value.length > 0
      return String(value ?? '').trim() !== ''
    }
    if (isBetweenOperator(operator)) {
      const from = typeof value === 'object' && value ? value.from : ''
      const to = typeof value === 'object' && value ? value.to : ''
      return String(from ?? '').trim() !== '' && String(to ?? '').trim() !== ''
    }
    return String(value ?? '').trim() !== ''
  }

  return {
    FILTER_GROUPS,
    conditionHasValue,
    emptyValueForOperator,
    getDefaultOperatorForField,
    getFilterFieldDef,
    getOperatorsForFilterField,
  }
}
