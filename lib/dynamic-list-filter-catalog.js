/**
 * Dynamic List / Leads filter catalog from DanceStudio CRM Filter Reference.
 * 9 groups · field operators · value types for Filters sidebar + condition editor.
 */

export const FILTER_OPERATORS = [
  { value: 'eq', label: 'Equals' },
  { value: 'ne', label: 'Exclude' },
  { value: 'in', label: 'In' },
  { value: 'not_in', label: 'Not in' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'exists', label: 'Exists' },
  { value: 'not_exists', label: 'Not exists' },
  { value: 'is_true', label: 'Is true' },
  { value: 'is_false', label: 'Is false' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less or equal' },
  { value: 'between', label: 'Between' },
  { value: 'within_days', label: 'Within days' },
  { value: 'older_than_days', label: 'Older than days' },
]

export const OPERATOR_LABEL_MAP = Object.fromEntries(FILTER_OPERATORS.map((o) => [o.value, o.label]))

/** Operators that take no free-form value (or use a fixed true/false). */
export const VALUELESS_OPERATORS = new Set(['exists', 'not_exists', 'is_true', 'is_false'])

/** Operators that take multiple select values. */
export const MULTI_VALUE_OPERATORS = new Set(['in', 'not_in', 'ne'])

/** Operators that take a { from, to } range. */
export const BETWEEN_OPERATORS = new Set(['between'])

export function usesMultiValueOperator(operator = 'eq') {
  return MULTI_VALUE_OPERATORS.has(operator)
}

export function isValuelessOperator(operator = 'eq') {
  return VALUELESS_OPERATORS.has(operator)
}

export function isBetweenOperator(operator = 'eq') {
  return BETWEEN_OPERATORS.has(operator)
}

const OP = {
  eq: 'eq',
  ne: 'ne',
  in: 'in',
  not_in: 'not_in',
  contains: 'contains',
  starts_with: 'starts_with',
  exists: 'exists',
  not_exists: 'not_exists',
  is_true: 'is_true',
  is_false: 'is_false',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  between: 'between',
  within_days: 'within_days',
  older_than_days: 'older_than_days',
}

function field(def) {
  return {
    operators: [OP.eq],
    inputType: 'text',
    optionsKey: null,
    staticOptions: null,
    notes: '',
    ...def,
  }
}

export const FILTER_GROUPS = [
  {
    id: 'lead_profile',
    label: 'Lead Profile',
    description: 'Fields stored on the Lead document.',
    fields: [
      field({
        value: 'stage',
        label: 'Stage',
        inputType: 'select',
        optionsKey: 'stage',
        operators: [OP.eq, OP.ne, OP.in, OP.not_in],
      }),
      field({
        value: 'uploadType',
        label: 'Upload type',
        inputType: 'select',
        optionsKey: 'uploadType',
        operators: [OP.eq, OP.ne, OP.in, OP.not_in],
      }),
      field({
        value: 'reason',
        label: 'Reason',
        inputType: 'select',
        optionsKey: 'reason',
        operators: [OP.eq, OP.ne, OP.in, OP.contains, OP.exists, OP.not_exists],
      }),
      field({
        value: 'bookingStatus',
        label: 'Booking status',
        inputType: 'select',
        optionsKey: 'bookingStatus',
        operators: [OP.eq, OP.ne],
      }),
      field({
        value: 'isEscalated',
        label: 'Escalated',
        inputType: 'boolean',
        operators: [OP.is_true, OP.is_false],
      }),
      field({
        value: 'assignedAiAgent',
        label: 'Assigned AI agent',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.exists, OP.not_exists],
      }),
      field({
        value: 'assignedHumanAgent',
        label: 'Assigned human agent',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.exists, OP.not_exists],
      }),
      field({
        value: 'name',
        label: 'Name',
        inputType: 'text',
        operators: [OP.contains, OP.starts_with, OP.eq, OP.ne],
      }),
      field({
        value: 'email',
        label: 'Email',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.contains, OP.exists],
      }),
      field({
        value: 'phoneNumber',
        label: 'Phone number',
        inputType: 'text',
        operators: [OP.exists, OP.not_exists, OP.starts_with],
      }),
      field({
        value: 'location',
        label: 'Location (text)',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.contains, OP.exists],
      }),
      field({
        value: 'locationID',
        label: 'Location',
        inputType: 'select',
        optionsKey: 'locations',
        operators: [OP.eq, OP.ne, OP.in, OP.exists, OP.not_exists],
      }),
      field({
        value: 'formID',
        label: 'Form',
        inputType: 'select',
        optionsKey: 'forms',
        operators: [OP.eq, OP.exists, OP.not_exists],
      }),
      field({
        value: 'metadata',
        label: 'Metadata key',
        inputType: 'metadata',
        operators: [OP.eq, OP.ne, OP.contains, OP.exists, OP.not_exists],
        notes: 'Filter any metadata key, e.g. source_campaign',
      }),
    ],
  },
  {
    id: 'utm',
    label: 'UTM / Attribution',
    description: 'Ad and traffic source parameters captured when the lead enters.',
    fields: [
      field({
        value: 'utm_source',
        label: 'UTM source',
        inputType: 'select',
        optionsKey: 'source',
        operators: [OP.eq, OP.ne, OP.in, OP.exists, OP.not_exists],
      }),
      field({
        value: 'utm_medium',
        label: 'UTM medium',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.contains, OP.exists, OP.not_exists],
      }),
      field({
        value: 'utm_campaign',
        label: 'UTM campaign',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.contains, OP.in, OP.exists],
      }),
      field({
        value: 'utm_term',
        label: 'UTM term',
        inputType: 'text',
        operators: [OP.eq, OP.contains, OP.exists, OP.not_exists],
      }),
      field({
        value: 'utm_content',
        label: 'UTM content',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.contains, OP.exists],
      }),
      field({
        value: 'utm_keyword',
        label: 'UTM keyword',
        inputType: 'text',
        operators: [OP.eq, OP.contains, OP.exists, OP.not_exists],
      }),
      field({
        value: 'utm_device',
        label: 'UTM device',
        inputType: 'select',
        staticOptions: ['mobile', 'desktop', 'tablet'],
        operators: [OP.eq, OP.ne, OP.in, OP.exists],
      }),
      field({
        value: 'utm_browser',
        label: 'UTM browser',
        inputType: 'text',
        operators: [OP.eq, OP.ne, OP.exists],
      }),
      field({
        value: 'utm_os',
        label: 'UTM OS',
        inputType: 'select',
        staticOptions: ['iOS', 'Android', 'Windows', 'macOS'],
        operators: [OP.eq, OP.ne, OP.in, OP.exists],
      }),
      field({
        value: 'utm_location',
        label: 'UTM location',
        inputType: 'text',
        operators: [OP.eq, OP.contains, OP.exists],
      }),
      field({
        value: 'utm_placement',
        label: 'UTM placement',
        inputType: 'text',
        operators: [OP.eq, OP.contains, OP.exists],
      }),
      field({
        value: 'utm_matchtype',
        label: 'UTM match type',
        inputType: 'select',
        staticOptions: ['exact', 'phrase', 'broad'],
        operators: [OP.eq, OP.ne, OP.in, OP.exists],
      }),
      field({
        value: 'utm_network',
        label: 'UTM network',
        inputType: 'select',
        staticOptions: [
          { value: 'g', label: 'Google Search (g)' },
          { value: 'd', label: 'Display (d)' },
          { value: 'yt', label: 'YouTube (yt)' },
        ],
        operators: [OP.eq, OP.ne, OP.in, OP.exists],
      }),
      field({
        value: 'utm_id',
        label: 'UTM id',
        inputType: 'text',
        operators: [OP.eq, OP.in, OP.exists, OP.not_exists],
      }),
    ],
  },
  {
    id: 'timing',
    label: 'lead create/update timing',
    description: 'Date-based filters on when the lead was created or last modified.',
    fields: [
      field({
        value: 'createdAt',
        label: 'Created at',
        inputType: 'date',
        operators: [OP.eq, OP.within_days, OP.older_than_days, OP.between, OP.gt, OP.lt],
      }),
      field({
        value: 'updatedAt',
        label: 'Updated at',
        inputType: 'date',
        operators: [OP.eq, OP.within_days, OP.older_than_days, OP.between, OP.gt, OP.lt],
      }),
      field({
        value: 'createdAtDayOfWeek',
        label: 'Created (day of week)',
        inputType: 'select',
        staticOptions: [
          { value: 'Mon', label: 'Mon' },
          { value: 'Tue', label: 'Tue' },
          { value: 'Wed', label: 'Wed' },
          { value: 'Thu', label: 'Thu' },
          { value: 'Fri', label: 'Fri' },
          { value: 'Sat', label: 'Sat' },
          { value: 'Sun', label: 'Sun' },
        ],
        operators: [OP.in],
      }),
      field({
        value: 'createdAtHour',
        label: 'Created (hour)',
        inputType: 'number',
        operators: [OP.between, OP.gte, OP.lte],
        notes: '0–23',
      }),
    ],
  },
  {
    id: 'callback',
    label: 'Callback',
    description: 'Follow-up callback date scheduled on the lead.',
    fields: [
      field({
        value: 'callbackDate',
        label: 'Callback date',
        inputType: 'date',
        operators: [OP.eq, OP.between, OP.gt, OP.lt, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists],
      }),
    ],
  },
  {
    id: 'sms',
    label: 'SMS Activity',
    description: 'Cross-collection lookup against SMS history.',
    fields: [
      field({ value: 'sms.hasAny', label: 'Has any SMS', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'sms.totalCount', label: 'SMS total count', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({
        value: 'sms.status',
        label: 'SMS status',
        inputType: 'select',
        staticOptions: ['queued', 'sent', 'delivered', 'failed', 'undelivered', 'received'],
        operators: [OP.in, OP.not_in],
      }),
      field({ value: 'sms.hasDelivered', label: 'Has delivered SMS', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'sms.hasFailed', label: 'Has failed SMS', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'sms.hasIncoming', label: 'Has incoming SMS', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({
        value: 'sms.lastSentAt',
        label: 'SMS last sent at',
        inputType: 'date',
        operators: [OP.eq, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists],
      }),
      field({ value: 'sms.countInDays', label: 'SMS count in days', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
    ],
  },
  {
    id: 'email',
    label: 'Email Activity',
    description: 'Cross-collection lookup against email history.',
    fields: [
      field({ value: 'email.hasAny', label: 'Has any email', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'email.totalCount', label: 'Email total count', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'email.hasBounced', label: 'Has bounced email', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'email.status', label: 'Email status', inputType: 'text', operators: [OP.eq, OP.ne, OP.in] }),
      field({
        value: 'email.lastSentAt',
        label: 'Email last sent at',
        inputType: 'date',
        operators: [OP.eq, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists],
      }),
      field({ value: 'email.subject', label: 'Email subject', inputType: 'text', operators: [OP.contains, OP.eq] }),
      field({ value: 'email.countInDays', label: 'Email count in days', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
    ],
  },
  {
    id: 'ai_call',
    label: 'AI Call Activity',
    description: 'Cross-collection lookup against AI call details.',
    fields: [
      field({ value: 'aiCall.hasAny', label: 'Has any AI call', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'aiCall.totalCount', label: 'AI call total count', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'aiCall.status', label: 'AI call status', inputType: 'text', operators: [OP.eq, OP.ne, OP.in] }),
      field({
        value: 'aiCall.endedReason',
        label: 'AI call ended reason',
        inputType: 'select',
        staticOptions: ['customer-ended-call', 'voicemail', 'assistant-error', 'no-answer'],
        operators: [OP.eq, OP.ne, OP.in, OP.not_in, OP.exists],
      }),
      field({ value: 'aiCall.hasTranscript', label: 'Has transcript', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'aiCall.hasRecording', label: 'Has recording', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({
        value: 'aiCall.successEvaluation',
        label: 'Success evaluation',
        inputType: 'select',
        staticOptions: ['success', 'partial', 'failure'],
        operators: [OP.eq, OP.ne, OP.in, OP.exists],
      }),
      field({
        value: 'aiCall.lastCallAt',
        label: 'AI call last at',
        inputType: 'date',
        operators: [OP.eq, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists],
      }),
      field({ value: 'aiCall.countInDays', label: 'AI call count in days', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
    ],
  },
  {
    id: 'human_call',
    label: 'Human Call Activity',
    description: 'Cross-collection lookup against human call history.',
    fields: [
      field({ value: 'humanCall.hasAny', label: 'Has any human call', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'humanCall.totalCount', label: 'Human call total count', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({
        value: 'humanCall.status',
        label: 'Human call status',
        inputType: 'select',
        staticOptions: ['queued', 'initiated', 'failed'],
        operators: [OP.eq, OP.ne, OP.in],
      }),
      field({
        value: 'humanCall.lastCallAt',
        label: 'Human call last at',
        inputType: 'date',
        operators: [OP.eq, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists],
      }),
      field({ value: 'humanCall.countInDays', label: 'Human call count in days', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
    ],
  },
  {
    id: 'campaign',
    label: 'Campaign Activity',
    description: 'Cross-collection lookup against campaigns and steps.',
    fields: [
      field({ value: 'campaign.isActive', label: 'In active campaign', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'campaign.totalCount', label: 'Campaign total count', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({
        value: 'campaign.status',
        label: 'Campaign status',
        inputType: 'select',
        staticOptions: ['active', 'inactive'],
        operators: [OP.eq, OP.ne, OP.in],
      }),
      field({ value: 'campaign.hasCompleted', label: 'Has completed campaign', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({
        value: 'campaign.lastStartedAt',
        label: 'Campaign last started at',
        inputType: 'date',
        operators: [OP.eq, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists],
      }),
      field({
        value: 'campaign.stepType',
        label: 'Campaign step type',
        inputType: 'select',
        staticOptions: ['email', 'sms', 'aiCall', 'humanCall'],
        operators: [OP.in, OP.not_in],
      }),
      field({
        value: 'campaign.stepStatus',
        label: 'Campaign step status',
        inputType: 'select',
        staticOptions: ['scheduled', 'completed', 'failed', 'skipped'],
        operators: [OP.in, OP.not_in],
      }),
      field({ value: 'campaign.hasFailedStep', label: 'Has failed step', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
    ],
  },
  {
    id: 'conversion',
    label: 'Conversion',
    description: 'Whether the lead has converted to a customer.',
    fields: [
      field({
        value: 'convertedCustomerID',
        label: 'Converted customer',
        inputType: 'boolean',
        operators: [OP.exists, OP.not_exists],
      }),
      field({
        value: 'isConverted',
        label: 'Is converted',
        inputType: 'boolean',
        operators: [OP.is_true, OP.is_false],
      }),
    ],
  },
]

export const ALL_FILTER_FIELDS = FILTER_GROUPS.flatMap((group) => group.fields)

export const FILTER_FIELD_MAP = Object.fromEntries(ALL_FILTER_FIELDS.map((f) => [f.value, f]))

export function getFilterFieldDef(field) {
  return FILTER_FIELD_MAP[field] || null
}

export function getOperatorsForFilterField(field) {
  const def = getFilterFieldDef(field)
  if (!def) return FILTER_OPERATORS.filter((o) => ['eq', 'ne', 'in'].includes(o.value))
  return FILTER_OPERATORS.filter((o) => def.operators.includes(o.value)).map((o) => {
    // Date equality: send operator "eq" with YYYY-MM-DD; label reads naturally as "On".
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

export function getDefaultOperatorForField(field) {
  const def = getFilterFieldDef(field)
  return def?.operators?.[0] || 'eq'
}

export function emptyValueForOperator(operator) {
  if (isValuelessOperator(operator)) return true
  if (usesMultiValueOperator(operator)) return []
  if (isBetweenOperator(operator)) return { from: '', to: '' }
  return ''
}

export function conditionHasValue(condition) {
  if (!condition?.field) return false
  const operator = condition.operator || 'eq'
  if (isValuelessOperator(operator)) return true
  const value = condition.value
  if (usesMultiValueOperator(operator)) {
    if (Array.isArray(value)) return value.length > 0
    return String(value ?? '').trim() !== ''
  }
  if (isBetweenOperator(operator)) {
    const from = typeof value === 'object' && value ? value.from : Array.isArray(value) ? value[0] : ''
    const to = typeof value === 'object' && value ? value.to : Array.isArray(value) ? value[1] : ''
    return String(from ?? '').trim() !== '' && String(to ?? '').trim() !== ''
  }
  if (typeof value === 'object' && value && 'key' in value) {
    return String(value.key ?? '').trim() !== '' && (isValuelessOperator(operator) || String(value.value ?? '').trim() !== '')
  }
  return String(value ?? '').trim() !== ''
}

export function normalizeFilterConditionValue(operator, value, field) {
  if (isValuelessOperator(operator)) return true
  if (usesMultiValueOperator(operator)) {
    if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean)
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    }
    return []
  }
  if (isBetweenOperator(operator)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { from: String(value.from ?? '').trim(), to: String(value.to ?? '').trim() }
    }
    if (Array.isArray(value)) {
      return { from: String(value[0] ?? '').trim(), to: String(value[1] ?? '').trim() }
    }
    return { from: '', to: '' }
  }
  if (field === 'metadata' && value && typeof value === 'object') {
    return {
      key: String(value.key ?? '').trim(),
      value: String(value.value ?? '').trim(),
    }
  }
  if (Array.isArray(value)) return String(value[0] ?? '').trim()
  return String(value ?? '').trim()
}

export function serializeFilterConditionForApi(condition) {
  const field = condition?.field
  const operator = condition?.operator || getDefaultOperatorForField(field)
  const value = normalizeFilterConditionValue(operator, condition?.value, field)

  if (field === 'metadata' && value && typeof value === 'object') {
    return {
      field: value.key ? `metadata.${value.key}` : 'metadata',
      operator,
      value: isValuelessOperator(operator) ? true : value.value,
    }
  }

  if (isBetweenOperator(operator) && value && typeof value === 'object') {
    return { field, operator, value: [value.from, value.to] }
  }

  return {
    field,
    operator,
    value: isValuelessOperator(operator) ? true : value,
  }
}

/** Keep groupId when building UI/list prefills; strip for API flat condition arrays. */
export function serializeFilterConditionForUi(condition) {
  return {
    ...serializeFilterConditionForApi(condition),
    ...(condition?.groupId ? { groupId: condition.groupId } : {}),
    ...(condition?.id ? { id: condition.id } : {}),
  }
}
