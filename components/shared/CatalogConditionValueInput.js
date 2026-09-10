'use client'

import MultiSelectCheckboxDropdown from '@/components/shared/MultiSelectCheckboxDropdown'
import {
  emptyValueForOperator,
  getFilterFieldDef as getLeadFilterFieldDef,
  isBetweenOperator,
  isValuelessOperator,
  usesMultiValueOperator,
} from '@/lib/dynamic-list-filter-catalog'
import { getCustomerFilterFieldDef } from '@/lib/customer-list-filter-catalog'
import { getFieldValueOptions as getCustomerFieldValueOptions } from '@/lib/customer-filter-fields'
import { getFieldValueOptions as getLeadFieldValueOptions } from '@/lib/lead-filter-fields'
import { formatFieldDisplayValue } from '@/lib/dynamic-list-normalize'
import { useLeadStages } from '@/lib/lead-stages'
import { REPORT_FILTER_CATALOGS, DASHBOARD_DETAILS_FILTER_CATALOGS } from '@/lib/report-filter-catalogs'

const inputClass =
  'h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none focus:border-[var(--studio-primary)]'

function toOptions(staticOptions) {
  if (!Array.isArray(staticOptions)) return []
  return staticOptions.map((opt) =>
    typeof opt === 'string'
      ? { value: opt, label: formatFieldDisplayValue(opt) }
      : { value: opt.value, label: opt.label || formatFieldDisplayValue(opt.value) }
  )
}

export default function CatalogConditionValueInput({
  field,
  operator,
  value,
  onChange,
  entityType = 'lead',
  catalogKey = null,
  catalogOverride = null,
  leadReasons = [],
  locations = [],
  forms = [],
  teachers = [],
  tags = [],
  memberships = [],
  packages = [],
  loadingOptions = false,
}) {
  const { stages } = useLeadStages()
  const reportCatalog =
    entityType === 'report'
      ? catalogOverride ||
        DASHBOARD_DETAILS_FILTER_CATALOGS[catalogKey] ||
        REPORT_FILTER_CATALOGS[catalogKey]
      : null
  const getFilterFieldDef =
    entityType === 'customer'
      ? getCustomerFilterFieldDef
      : entityType === 'report'
        ? reportCatalog?.getFilterFieldDef || (() => null)
        : getLeadFilterFieldDef
  const getFieldValueOptions =
    entityType === 'customer' ? getCustomerFieldValueOptions : getLeadFieldValueOptions
  const def = getFilterFieldDef(field)
  if (!def) {
    return (
      <input
        value={String(value || '')}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
        placeholder="Enter value"
      />
    )
  }

  if (isValuelessOperator(operator)) {
    return (
      <div className="flex h-10 items-center rounded-lg border border-dashed border-border px-3 text-[12px] text-muted-foreground">
        No value needed
      </div>
    )
  }

  if (def.inputType === 'metadata' || def.inputType === 'customField') {
    const meta = value && typeof value === 'object' ? value : { key: '', value: '' }
    return (
      <div className="grid grid-cols-2 gap-2">
        <input
          value={String(meta.key || '')}
          onChange={(e) => onChange({ ...meta, key: e.target.value })}
          placeholder={def.inputType === 'customField' ? 'custom field key' : 'metadata key'}
          className={inputClass}
        />
        <input
          value={String(meta.value || '')}
          onChange={(e) => onChange({ ...meta, value: e.target.value })}
          placeholder="value"
          className={inputClass}
          disabled={isValuelessOperator(operator)}
        />
      </div>
    )
  }

  if (isBetweenOperator(operator)) {
    const range = value && typeof value === 'object' && !Array.isArray(value) ? value : { from: '', to: '' }
    const type = def.inputType === 'number' ? 'number' : def.inputType === 'date' ? 'date' : 'text'
    return (
      <div className="grid grid-cols-2 gap-2">
        <input
          type={type}
          value={String(range.from || '')}
          onChange={(e) => onChange({ ...range, from: e.target.value })}
          placeholder="From"
          className={inputClass}
        />
        <input
          type={type}
          value={String(range.to || '')}
          onChange={(e) => onChange({ ...range, to: e.target.value })}
          placeholder="To"
          className={inputClass}
        />
      </div>
    )
  }

  const context = { leadReasons, locations, forms, teachers, tags, memberships, stages, packages }
  let labeledOptions = null
  if (def.optionsKey) {
    labeledOptions = getFieldValueOptions(def.optionsKey === 'source' ? 'source' : def.value, context)
    if (def.optionsKey === 'source' || def.value === 'utm_source') {
      labeledOptions = getFieldValueOptions('source', context)
    }
    if (def.optionsKey === 'locations' || def.value === 'locationID') {
      labeledOptions = getFieldValueOptions('locationID', context)
    }
    if (def.optionsKey === 'forms' || def.value === 'formID') {
      labeledOptions = getFieldValueOptions('formID', context)
    }
    if (def.optionsKey === 'reason' || def.value === 'reason') {
      labeledOptions = getFieldValueOptions('reason', context)
    }
    if (def.optionsKey === 'stage' || def.value === 'stage') {
      labeledOptions = getFieldValueOptions('stage', context)
    }
    if (def.optionsKey === 'uploadType' || def.value === 'uploadType') {
      labeledOptions = getFieldValueOptions('uploadType', context)
    }
    if (def.optionsKey === 'bookingStatus' || def.value === 'bookingStatus') {
      labeledOptions = getFieldValueOptions('bookingStatus', context)
    }
    if (def.optionsKey === 'packages' || def.value === 'package.packageID') {
      labeledOptions = getFieldValueOptions('package.packageID', context)
    }
  } else if (def.staticOptions) {
    labeledOptions = toOptions(def.staticOptions)
  }

  if (def.inputType === 'multiselect' && usesMultiValueOperator(operator)) {
    const values = Array.isArray(value) ? value : value ? [String(value)] : []
    const labeledOptions = getFieldValueOptions(field, context) || []
    return (
      <MultiSelectCheckboxDropdown
        options={labeledOptions}
        values={values}
        onChange={onChange}
        placeholder={operator === 'ne' || operator === 'not_in' ? 'Select values to exclude' : 'Select one or more'}
        disabled={loadingOptions}
        emptyMessage={loadingOptions ? 'Loading…' : 'No options available.'}
      />
    )
  }

  if (usesMultiValueOperator(operator)) {
    const values = Array.isArray(value) ? value : value ? [String(value)] : []
    if (labeledOptions) {
      return (
        <MultiSelectCheckboxDropdown
          options={labeledOptions}
          values={values}
          onChange={onChange}
          placeholder={operator === 'ne' || operator === 'not_in' ? 'Select values to exclude' : 'Select one or more'}
          disabled={loadingOptions}
          emptyMessage={loadingOptions ? 'Loading…' : 'No options available.'}
        />
      )
    }
    return (
      <input
        value={values.join(', ')}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          )
        }
        placeholder="value1, value2"
        className={inputClass}
      />
    )
  }

  if (operator === 'within_days' || operator === 'older_than_days' || def.inputType === 'number') {
    return (
      <input
        type="number"
        min={0}
        step={1}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={operator === 'within_days' || operator === 'older_than_days' ? 'e.g. 30' : 'Enter number'}
        className={inputClass}
      />
    )
  }

  if (def.inputType === 'date' && (operator === 'gt' || operator === 'lt' || operator === 'gte' || operator === 'lte' || operator === 'eq')) {
    return (
      <input type="date" value={String(value || '')} onChange={(e) => onChange(e.target.value)} className={inputClass} />
    )
  }

  if (labeledOptions) {
    return (
      <select
        value={String(value || '')}
        onChange={(e) => onChange(e.target.value)}
        disabled={loadingOptions}
        className={inputClass}
      >
        <option value="">{loadingOptions ? 'Loading…' : 'Select value'}</option>
        {labeledOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <input
      value={String(value || '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Enter value"
      className={inputClass}
    />
  )
}

export { emptyValueForOperator }
