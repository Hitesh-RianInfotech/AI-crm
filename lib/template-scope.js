/**
 * Shared helpers for SMS / email / form templateScope (mirrors workflowScope).
 * List APIs return legacy flat arrays plus ownTemplates / orgDefaultTemplates / globalTemplates.
 */

export const TEMPLATE_SCOPE = {
  OWN: null,
  ORG_DEFAULT: 'organization_default',
  GLOBAL: 'global',
}

export function normalizeTemplateScope(value) {
  if (value === 'organization_default' || value === 'global') return value
  return null
}

export function templateScopeVariant(template) {
  const scope = normalizeTemplateScope(template?.templateScope)
  if (scope === 'organization_default') return 'org_default'
  if (scope === 'global') return 'global'
  return 'own'
}

export function templateScopeBadge(variant) {
  if (variant === 'org_default') {
    return {
      label: 'Org Default',
      className: 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
    }
  }
  if (variant === 'global') {
    return {
      label: 'Global',
      className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    }
  }
  return null
}

/**
 * @param {object} payload - API `data` object
 * @param {string} legacyKey - e.g. 'smsList' | 'emails' | 'forms'
 */
export function parseScopedTemplateList(payload, legacyKey) {
  const root = payload?.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload

  const own = Array.isArray(root?.ownTemplates) ? root.ownTemplates : null
  const org = Array.isArray(root?.orgDefaultTemplates) ? root.orgDefaultTemplates : null
  const global = Array.isArray(root?.globalTemplates) ? root.globalTemplates : null

  let legacy = []
  if (Array.isArray(root?.[legacyKey])) legacy = root[legacyKey]
  else if (Array.isArray(root?.data?.[legacyKey])) legacy = root.data[legacyKey]
  else if (Array.isArray(root)) legacy = root
  else if (Array.isArray(root?.data)) legacy = root.data

  const hasBuckets = own != null || org != null || global != null
  const ownTemplates = hasBuckets ? own || [] : legacy
  const orgDefaultTemplates = hasBuckets ? org || [] : []
  const globalTemplates = hasBuckets ? global || [] : []
  const list = [...ownTemplates, ...orgDefaultTemplates, ...globalTemplates]

  const pagination = root?.pagination ?? payload?.pagination

  return {
    hasBuckets,
    ownTemplates,
    orgDefaultTemplates,
    globalTemplates,
    list,
    total: pagination?.total ?? list.length,
    totalPages: pagination?.totalPages ?? pagination?.pages,
  }
}

export function mapTemplateInBuckets(buckets, id, updater) {
  const match = (t) => String(t?._id || t?.id) === String(id)
  const mapList = (arr) => (arr || []).map((t) => (match(t) ? updater(t) : t))
  return {
    ...buckets,
    ownTemplates: mapList(buckets.ownTemplates),
    orgDefaultTemplates: mapList(buckets.orgDefaultTemplates),
    globalTemplates: mapList(buckets.globalTemplates),
    list: mapList(buckets.list),
  }
}

export function removeTemplateFromBuckets(buckets, id) {
  const keep = (t) => String(t?._id || t?.id) !== String(id)
  const ownTemplates = (buckets.ownTemplates || []).filter(keep)
  const orgDefaultTemplates = (buckets.orgDefaultTemplates || []).filter(keep)
  const globalTemplates = (buckets.globalTemplates || []).filter(keep)
  return {
    ...buckets,
    ownTemplates,
    orgDefaultTemplates,
    globalTemplates,
    list: [...ownTemplates, ...orgDefaultTemplates, ...globalTemplates],
  }
}

/** Studio + admin merge tags resolved at send/use time from current org location / admin. */
export const STUDIO_TEMPLATE_VARIABLES = [
  { name: '{{studio_name}}', description: 'Current studio / location name' },
  { name: '{{studio_phone}}', description: 'Studio phone' },
  { name: '{{studio_email}}', description: 'Studio email' },
  { name: '{{studio_website}}', description: 'Studio website' },
  { name: '{{studio_address}}', description: 'Studio street address' },
  { name: '{{studio_city}}', description: 'Studio city' },
  { name: '{{studio_state}}', description: 'Studio state' },
  { name: '{{studio_zip}}', description: 'Studio ZIP' },
]

export const ADMIN_TEMPLATE_VARIABLES = [
  { name: '{{admin_name}}', description: 'Admin full name' },
  { name: '{{admin_first_name}}', description: 'Admin first name' },
  { name: '{{admin_last_name}}', description: 'Admin last name' },
]
