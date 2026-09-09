/**
 * Customer Dynamic List filter catalog (customer-list-filter-reference.pdf).
 * Groups · fields · shared operators with lead catalog.
 */

export {
  FILTER_OPERATORS,
  OPERATOR_LABEL_MAP,
  VALUELESS_OPERATORS,
  MULTI_VALUE_OPERATORS,
  BETWEEN_OPERATORS,
  usesMultiValueOperator,
  isValuelessOperator,
  isBetweenOperator,
  emptyValueForOperator,
  conditionHasValue,
  normalizeFilterConditionValue,
  serializeFilterConditionForApi,
  serializeFilterConditionForUi,
} from '@/lib/dynamic-list-filter-catalog'

import {
  FILTER_OPERATORS,
  emptyValueForOperator,
  conditionHasValue,
  getDefaultOperatorForField as getLeadDefaultOperator,
  getOperatorsForFilterField as getLeadOperators,
  isBetweenOperator,
  isValuelessOperator,
  normalizeFilterConditionValue,
  serializeFilterConditionForApi,
  usesMultiValueOperator,
} from '@/lib/dynamic-list-filter-catalog'
import { CUSTOMER_LIFECYCLE_STATUS_OPTIONS } from '@/lib/customer-lifecycle'

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

const GENDER_OPTIONS = ['male', 'female', 'other', 'prefer_not_to_say']
const MEMBERSHIP_STATUS = ['active', 'expired', 'cancelled', 'frozen']
const PAYMENT_STATUS = ['paid', 'partial', 'unpaid']
const BILLING_TYPE = ['one_time', 'flexible', 'payment_plan']
const RENEWAL_METHOD = ['cash', 'card', 'online', 'cheque', 'other']
const PACKAGE_STATUS = ['active', 'expired', 'exhausted', 'cancelled']
const PACKAGE_BILLING = ['one_time', 'payment_plan', 'flexible', 'pay_per_session']
const ENROLLMENT_STATUS = ['active', 'completed', 'cancelled']
const SESSION_STATUS = [
  'scheduled',
  'completed',
  'cancelled_no_charge',
  'cancelled_charged',
  'no_show_no_charge',
  'no_show_charged',
]
const SESSION_TYPE = ['lesson', 'trial', 'private', 'event', 'record']
const CHARGE_METHOD = ['package', 'credits', 'direct', 'membership', 'mixed', 'none']
const PAYMENT_METHOD = ['cash', 'card', 'online', 'cheque', 'other', 'wallet']
const PAYMENT_TYPE = [
  'package_purchase',
  'membership_purchase',
  'membership_renewal',
  'credit_topup',
  'session_payment',
  'refund',
]
const PAYMENT_RECORD_STATUS = ['completed', 'pending', 'failed']
const WALLET_STATUS = ['active', 'frozen']
const CONTRACT_STATUS = ['draft', 'sent', 'signed', 'expired', 'revoked']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

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

export const CUSTOMER_FILTER_GROUPS = [
  {
    id: 'customer_profile',
    label: 'Customer Profile',
    description: 'Fields stored directly on the Customer document.',
    fields: [
      field({ value: 'name', label: 'Name', inputType: 'text', operators: [OP.contains, OP.starts_with, OP.eq, OP.ne] }),
      field({ value: 'email', label: 'Email', inputType: 'text', operators: [OP.eq, OP.ne, OP.contains, OP.exists] }),
      field({
        value: 'phoneNumber',
        label: 'Phone number',
        inputType: 'text',
        operators: [OP.exists, OP.not_exists, OP.starts_with],
      }),
      field({
        value: 'locationID',
        label: 'Location',
        inputType: 'select',
        optionsKey: 'locations',
        operators: [OP.eq, OP.ne, OP.in, OP.exists, OP.not_exists],
      }),
      field({
        value: 'credits',
        label: 'Credits',
        inputType: 'number',
        operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte, OP.between],
      }),
      field({
        value: 'lifecycleStatus',
        label: 'Lifecycle Status',
        inputType: 'select',
        staticOptions: CUSTOMER_LIFECYCLE_STATUS_OPTIONS,
        operators: [OP.eq, OP.ne, OP.in, OP.not_in, OP.exists, OP.not_exists],
      }),
      field({
        value: 'reason',
        label: 'Reason',
        inputType: 'select',
        optionsKey: 'reason',
        operators: [OP.eq, OP.ne, OP.in, OP.contains, OP.exists, OP.not_exists],
      }),
      field({
        value: 'classAssigned',
        label: 'Class assigned',
        inputType: 'boolean',
        operators: [OP.exists, OP.not_exists],
      }),
    ],
  },
  {
    id: 'demographics',
    label: 'Demographics',
    description: 'Age, gender, and address fields.',
    fields: [
      field({
        value: 'gender',
        label: 'Gender',
        inputType: 'select',
        staticOptions: GENDER_OPTIONS,
        operators: [OP.eq, OP.ne, OP.in],
      }),
      field({
        value: 'dateOfBirth',
        label: 'Date of birth',
        inputType: 'date',
        operators: [OP.eq, OP.exists, OP.not_exists],
      }),
      field({
        value: 'age',
        label: 'Age',
        inputType: 'number',
        operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte, OP.between],
      }),
      field({ value: 'address.city', label: 'City', inputType: 'text', operators: [OP.eq, OP.ne, OP.contains] }),
      field({ value: 'address.state', label: 'State', inputType: 'text', operators: [OP.eq, OP.ne, OP.in] }),
      field({ value: 'address.country', label: 'Country', inputType: 'text', operators: [OP.eq, OP.ne, OP.in] }),
      field({
        value: 'address.zipCode',
        label: 'ZIP code',
        inputType: 'text',
        operators: [OP.eq, OP.starts_with, OP.contains],
      }),
    ],
  },
  {
    id: 'tags_custom_fields',
    label: 'Tags & Custom Fields',
    description: 'Tags, custom fields, family members, and notes.',
    fields: [
      field({
        value: 'tags',
        label: 'Tags',
        inputType: 'multiselect',
        optionsKey: 'tags',
        operators: [OP.in, OP.not_in, OP.exists, OP.not_exists],
      }),
      field({
        value: 'tags.count',
        label: 'Tag count',
        inputType: 'number',
        operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte],
      }),
      field({
        value: 'notes.hasPinned',
        label: 'Has pinned note',
        inputType: 'boolean',
        operators: [OP.is_true, OP.is_false],
      }),
      field({
        value: 'customFields',
        label: 'Custom field',
        inputType: 'customField',
        operators: [OP.eq, OP.ne, OP.contains, OP.exists, OP.not_exists],
      }),
      field({
        value: 'members.count',
        label: 'Family member count',
        inputType: 'number',
        operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte],
      }),
      field({
        value: 'members.hasFamilyMembers',
        label: 'Has family members',
        inputType: 'boolean',
        operators: [OP.is_true, OP.is_false],
      }),
    ],
  },
  {
    id: 'timing',
    label: 'Timing',
    description: 'When the customer record was created or last updated.',
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
        staticOptions: WEEKDAYS,
        operators: [OP.in],
      }),
      field({
        value: 'createdAtMonth',
        label: 'Created (month)',
        inputType: 'select',
        staticOptions: MONTHS,
        operators: [OP.in],
      }),
    ],
  },
  {
    id: 'membership',
    label: 'Membership',
    description: 'Cross-collection filters against CustomerMembership records.',
    fields: [
      field({ value: 'membership.hasActive', label: 'Has active membership', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'membership.status', label: 'Membership status', inputType: 'select', staticOptions: MEMBERSHIP_STATUS, operators: [OP.eq, OP.ne, OP.in, OP.not_in] }),
      field({ value: 'membership.membershipName', label: 'Membership name', inputType: 'text', operators: [OP.eq, OP.ne, OP.contains, OP.in] }),
      field({ value: 'membership.totalCount', label: 'Total memberships', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'membership.expiryDate', label: 'Membership expiry', inputType: 'date', operators: [OP.eq, OP.within_days, OP.older_than_days, OP.between, OP.gt, OP.lt] }),
      field({ value: 'membership.purchaseDate', label: 'Membership purchase date', inputType: 'date', operators: [OP.eq, OP.within_days, OP.older_than_days, OP.between] }),
      field({ value: 'membership.paymentStatus', label: 'Membership payment status', inputType: 'select', staticOptions: PAYMENT_STATUS, operators: [OP.eq, OP.ne, OP.in] }),
      field({ value: 'membership.billingType', label: 'Membership billing type', inputType: 'select', staticOptions: BILLING_TYPE, operators: [OP.eq, OP.in] }),
      field({ value: 'membership.renewalMethod', label: 'Renewal method', inputType: 'select', staticOptions: RENEWAL_METHOD, operators: [OP.eq, OP.ne, OP.in] }),
      field({ value: 'membership.autoRenew', label: 'Auto renew', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'membership.isFrozen', label: 'Membership frozen', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'membership.price', label: 'Membership price', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte, OP.between] }),
      field({ value: 'membership.dueAmount', label: 'Due amount', inputType: 'number', operators: [OP.exists, OP.gt, OP.gte] }),
      field({ value: 'membership.durationDays', label: 'Duration (days)', inputType: 'number', operators: [OP.eq, OP.gt, OP.lt, OP.between] }),
      field({ value: 'membership.hasFreezes', label: 'Has freezes', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
    ],
  },
  {
    id: 'package',
    label: 'Package',
    description: 'Cross-collection filters against CustomerPackage records.',
    fields: [
      field({ value: 'package.hasActive', label: 'Has active package', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({
        value: 'package.packageID',
        label: 'Package (active enrollment)',
        inputType: 'select',
        optionsKey: 'packages',
        operators: [OP.eq, OP.ne, OP.in, OP.not_in],
      }),
      field({ value: 'package.status', label: 'Package status', inputType: 'select', staticOptions: PACKAGE_STATUS, operators: [OP.eq, OP.ne, OP.in] }),
      field({ value: 'package.totalCount', label: 'Total packages', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'package.expiryDate', label: 'Package expiry', inputType: 'date', operators: [OP.eq, OP.within_days, OP.older_than_days, OP.between] }),
      field({ value: 'package.paymentStatus', label: 'Package payment status', inputType: 'select', staticOptions: PAYMENT_STATUS, operators: [OP.eq, OP.in] }),
      field({ value: 'package.billingType', label: 'Package billing type', inputType: 'select', staticOptions: PACKAGE_BILLING, operators: [OP.eq, OP.in] }),
      field({ value: 'package.sessionsRemaining', label: 'Sessions remaining', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'package.sessionsUsed', label: 'Sessions used', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'package.totalPaid', label: 'Package total paid', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte, OP.between] }),
      field({ value: 'package.hasExhausted', label: 'Has exhausted package', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
    ],
  },
  {
    id: 'enrollment',
    label: 'Enrollment',
    description: 'Cross-collection filters against Enrollment records.',
    fields: [
      field({ value: 'enrollment.hasActive', label: 'Has active enrollment', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'enrollment.status', label: 'Enrollment status', inputType: 'select', staticOptions: ENROLLMENT_STATUS, operators: [OP.eq, OP.ne, OP.in] }),
      field({ value: 'enrollment.totalCount', label: 'Total enrollments', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'enrollment.hasTeacher', label: 'Has teacher', inputType: 'boolean', operators: [OP.exists, OP.not_exists] }),
      field({ value: 'enrollment.teacherID', label: 'Teacher', inputType: 'select', optionsKey: 'teachers', operators: [OP.eq, OP.ne, OP.in] }),
      field({ value: 'enrollment.hasCompleted', label: 'Has completed enrollment', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'enrollment.hasCancelled', label: 'Has cancelled enrollment', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
    ],
  },
  {
    id: 'sessions',
    label: 'Sessions / Bookings',
    description: 'Cross-collection filters against CalendarEvent records.',
    fields: [
      field({ value: 'session.totalCount', label: 'Total sessions', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte, OP.between] }),
      field({ value: 'session.completedCount', label: 'Completed sessions', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'session.status', label: 'Session status', inputType: 'select', staticOptions: SESSION_STATUS, operators: [OP.in, OP.not_in] }),
      field({ value: 'session.hasNoShow', label: 'Has no-show', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'session.noShowCount', label: 'No-show count', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'session.type', label: 'Session type', inputType: 'select', staticOptions: SESSION_TYPE, operators: [OP.in, OP.not_in] }),
      field({ value: 'session.lastSessionAt', label: 'Last session', inputType: 'date', operators: [OP.eq, OP.within_days, OP.older_than_days, OP.not_exists] }),
      field({ value: 'session.nextSessionAt', label: 'Next session', inputType: 'date', operators: [OP.eq, OP.within_days, OP.exists, OP.not_exists] }),
      field({ value: 'session.chargeMethod', label: 'Charge method', inputType: 'select', staticOptions: CHARGE_METHOD, operators: [OP.in, OP.not_in] }),
      field({ value: 'session.countInDays', label: 'Session count in days', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
    ],
  },
  {
    id: 'payments',
    label: 'Payments & Financial',
    description: 'Cross-collection filters against Payment records.',
    fields: [
      field({
        value: 'payment.totalSpend',
        label: 'Total Spend',
        inputType: 'number',
        // Lifetime net spend: completed payments excluding refunds (dollars).
        // Sort tip: payment.totalSpend desc on the customer list for highest spenders.
        operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte, OP.between, OP.exists, OP.not_exists],
      }),
      field({ value: 'payment.totalCount', label: 'Payment count', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'payment.lastPaymentAt', label: 'Last payment', inputType: 'date', operators: [OP.eq, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists] }),
      field({ value: 'payment.method', label: 'Payment method', inputType: 'select', staticOptions: PAYMENT_METHOD, operators: [OP.eq, OP.ne, OP.in, OP.not_in] }),
      field({ value: 'payment.type', label: 'Payment type', inputType: 'select', staticOptions: PAYMENT_TYPE, operators: [OP.in, OP.not_in] }),
      field({ value: 'payment.status', label: 'Payment status', inputType: 'select', staticOptions: PAYMENT_RECORD_STATUS, operators: [OP.eq, OP.in] }),
      field({ value: 'payment.hasRefund', label: 'Has refund', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'payment.countInDays', label: 'Payment count in days', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'payment.avgSpend', label: 'Average spend', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
    ],
  },
  {
    id: 'wallet',
    label: 'Wallet',
    description: 'Wallet balance and transaction history.',
    fields: [
      field({ value: 'wallet.balance', label: 'Wallet balance', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte, OP.lt, OP.lte, OP.between] }),
      field({ value: 'wallet.status', label: 'Wallet status', inputType: 'select', staticOptions: WALLET_STATUS, operators: [OP.eq] }),
      field({ value: 'wallet.hasFunds', label: 'Has funds', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'wallet.totalCreditsAdded', label: 'Total credits added', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
      field({ value: 'wallet.lastTopupAt', label: 'Last top-up', inputType: 'date', operators: [OP.eq, OP.within_days, OP.older_than_days, OP.not_exists] }),
      field({ value: 'wallet.transactionCount', label: 'Transaction count', inputType: 'number', operators: [OP.gt, OP.gte, OP.lt, OP.lte] }),
    ],
  },
  {
    id: 'contract',
    label: 'Contract',
    description: 'Contract records sent or signed by this customer.',
    fields: [
      field({ value: 'contract.hasAny', label: 'Has any contract', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'contract.status', label: 'Contract status', inputType: 'select', staticOptions: CONTRACT_STATUS, operators: [OP.eq, OP.ne, OP.in] }),
      field({ value: 'contract.hasSigned', label: 'Has signed contract', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
      field({ value: 'contract.signedAt', label: 'Signed at', inputType: 'date', operators: [OP.eq, OP.within_days, OP.older_than_days, OP.exists, OP.not_exists] }),
      field({ value: 'contract.totalCount', label: 'Total contracts', inputType: 'number', operators: [OP.eq, OP.gt, OP.gte] }),
      field({ value: 'contract.hasExpired', label: 'Has expired contract', inputType: 'boolean', operators: [OP.is_true, OP.is_false] }),
    ],
  },
]

export const ALL_CUSTOMER_FILTER_FIELDS = CUSTOMER_FILTER_GROUPS.flatMap((g) => g.fields)
export const CUSTOMER_FILTER_FIELD_MAP = Object.fromEntries(
  ALL_CUSTOMER_FILTER_FIELDS.map((f) => [f.value, f])
)

export function getCustomerFilterFieldDef(field) {
  if (String(field || '').startsWith('customFields.')) {
    return CUSTOMER_FILTER_FIELD_MAP.customFields || null
  }
  return CUSTOMER_FILTER_FIELD_MAP[field] || null
}

export function getOperatorsForCustomerFilterField(field) {
  const def = getCustomerFilterFieldDef(field)
  if (!def) return getLeadOperators(field)
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

export function getDefaultOperatorForCustomerField(field) {
  const def = getCustomerFilterFieldDef(field)
  return def?.operators?.[0] || getLeadDefaultOperator(field)
}

export function serializeCustomerFilterConditionForApi(condition) {
  const field = condition?.field
  const operator = condition?.operator || getDefaultOperatorForCustomerField(field)
  const value = normalizeFilterConditionValue(operator, condition?.value, field)

  if (field === 'customFields' && value && typeof value === 'object') {
    return {
      field: value.key ? `customFields.${value.key}` : 'customFields',
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
