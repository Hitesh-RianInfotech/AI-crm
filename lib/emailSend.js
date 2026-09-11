/**
 * Helpers for POST /api/email/send-one (see Email Send One API documentation).
 */

import { getEffectiveBranch } from './auth'
import { htmlHasStudioFooter } from './email-footer'
import { ADMIN_TEMPLATE_VARIABLES, STUDIO_TEMPLATE_VARIABLES } from './template-scope'

const TEMPLATE_VAR_PATTERN = /\{\{([a-zA-Z0-9_]+)\}\}/g

/** Normalize locationID from lead/contact into string ObjectIds. */
export function normalizeLocationIDs(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw.map((id) => String(id?._id ?? id)).filter(Boolean)
  }
  const id = String(raw?._id ?? raw)
  return id && id !== 'undefined' && id !== 'null' ? [id] : []
}

/**
 * Studio used for outbound email config.
 * Prefers the active branch header value; otherwise the lead's first location.
 */
export function resolvePreferredLocationID(lead = {}) {
  const branch = getEffectiveBranch()
  if (branch) return String(branch)
  return normalizeLocationIDs(lead.locationID)[0] || null
}

/**
 * Documented merge tags for UI / docs.
 * Contact tokens are resolved client-side in applyEmailTemplate.
 * studio_* / admin_* are resolved by the backend at send/use time — leave them
 * unchanged in applyEmailTemplate (do not invent fake values here).
 */
export const EMAIL_TEMPLATE_VARIABLES = [
  { token: '{{name}}', description: 'Full name' },
  { token: '{{first_name}}', description: 'First name' },
  { token: '{{email}}', description: 'Email address' },
  { token: '{{phoneNumber}}', description: 'Phone number' },
  { token: '{{stage}}', description: 'Lead stage' },
  { token: '{{location}}', description: 'Location' },
  { token: '{{reason}}', description: 'Reason' },
  { token: '{{bookingStatus}}', description: 'Booking status' },
  ...STUDIO_TEMPLATE_VARIABLES.map(({ name, description }) => ({
    token: name,
    description,
  })),
  ...ADMIN_TEMPLATE_VARIABLES.map(({ name, description }) => ({
    token: name,
    description,
  })),
]

function firstNameFromName(name) {
  if (!name || typeof name !== 'string') return ''
  return name.trim().split(/\s+/)[0] || ''
}

/** Build template variable map from a lead/contact object. */
export function getEmailTemplateVariables(lead = {}) {
  const vars = {
    name: lead.name || '',
    first_name: firstNameFromName(lead.name),
    email: lead.email || '',
    phoneNumber: lead.phoneNumber || '',
    stage: lead.stage || '',
    location: lead.location || '',
    reason: lead.reason || '',
    bookingStatus: lead.bookingStatus || '',
  }

  const metadata = lead.metadata
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    for (const [key, value] of Object.entries(metadata)) {
      if (/^[a-zA-Z0-9_]+$/.test(key) && value != null) {
        vars[key] = String(value)
      }
    }
  }

  return vars
}

/** Replace {{variable}} tokens; unknown tokens are left unchanged. */
export function applyEmailTemplate(text, lead = {}) {
  if (!text) return ''
  const vars = getEmailTemplateVariables(lead)
  return String(text).replace(TEMPLATE_VAR_PATTERN, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key] ?? ''
    }
    return match
  })
}

/** Full lead object for send-one (organisationID is resolved server-side). */
export function buildLeadRecipient(contact = {}, leadData = null) {
  const lead = leadData || {}
  const id = lead._id || contact.id
  const email = (lead.email || contact.email || '').trim()
  const name = lead.name || contact.name || ''

  const recipient = {
    email,
    name: name || undefined,
  }

  if (id) recipient._id = id
  if (lead.stage || contact.stage) recipient.stage = lead.stage || contact.stage
  if (lead.phoneNumber || contact.phoneNumber) {
    recipient.phoneNumber = lead.phoneNumber || contact.phoneNumber
  }
  if (lead.location || contact.location) recipient.location = lead.location || contact.location
  const locationIDs = normalizeLocationIDs(lead.locationID ?? contact.locationID)
  if (locationIDs.length) recipient.locationID = locationIDs
  if (lead.reason) recipient.reason = lead.reason
  if (lead.bookingStatus) recipient.bookingStatus = lead.bookingStatus
  if (lead.metadata && typeof lead.metadata === 'object') {
    recipient.metadata = lead.metadata
  }

  return recipient
}

/** Local `YYYY-MM-DDTHH:mm` for `<input type="datetime-local" min=…>`. */
export function toLocalDatetimeInputValue(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Min value for schedule pickers: ~1 minute from now, in local time. */
export function getScheduleMinLocalDatetime(offsetMs = 60_000) {
  return toLocalDatetimeInputValue(new Date(Date.now() + offsetMs))
}

/** Convert datetime-local value to ISO, or null if missing/invalid. */
export function toScheduleIsoOrNull(localDatetime, { requireFuture = false } = {}) {
  if (!localDatetime) return null
  const when = new Date(localDatetime)
  if (Number.isNaN(when.getTime())) return null
  if (requireFuture && when.getTime() <= Date.now()) return null
  return when.toISOString()
}

/** Wrap plain text as simple HTML for email body. */
export function plainTextToHtml(text) {
  const escaped = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`
}

export function validateEmailSendInput({ lead, subject, content, html, scheduleNow, scheduleDate }) {
  if (!lead?.email) {
    return 'Lead with email is required'
  }
  if (!subject?.trim()) {
    return 'Subject is required'
  }
  if (!String(html || content || '').trim()) {
    return 'Email html or text content is required'
  }
  if (scheduleNow === false) {
    if (!scheduleDate) {
      return 'scheduleDate is required when scheduleNow is false'
    }
    const when = new Date(scheduleDate)
    if (Number.isNaN(when.getTime())) {
      return 'scheduleDate must be a valid ISO datetime'
    }
    if (when.getTime() <= Date.now()) {
      return 'scheduleDate must be in the future'
    }
  }
  return null
}

/** Payload for POST /api/email/send-one (backend accepts `body` as HTML). */
export function buildSendOneEmailPayload({
  lead,
  subject,
  content,
  html = null,
  scheduleNow = true,
  scheduleDate = null,
  useTemplate = false,
  hasFooter = null,
}) {
  const bodyHtml = String(html || '').trim()
    ? String(html).trim()
    : plainTextToHtml(String(content || '').trim())
  const preferredLocationID = resolvePreferredLocationID(lead)
  const footerSaved =
    hasFooter === true || hasFooter === false
      ? Boolean(hasFooter)
      : htmlHasStudioFooter(bodyHtml)
  const payload = {
    lead,
    subject: String(subject || '').trim(),
    html: bodyHtml,
    body: bodyHtml,
    scheduleNow,
  }
  if (preferredLocationID) {
    payload.preferredLocationID = preferredLocationID
  }
  if (scheduleNow === false && scheduleDate) {
    payload.scheduleDate = scheduleDate
  }
  if (useTemplate) {
    payload.useTemplate = true
    payload.emailType = 'template'
    payload.hasFooter = footerSaved
    // Only skip auto branch footer when the template already saved one.
    if (footerSaved) payload.skipStudioFooter = true
  }
  return payload
}

/** Strip HTML tags for list previews and plain-text display. */
export function htmlToPlainText(html) {
  if (!html) return ''
  return String(html)
    // Remove non-visible blocks first so their contents don't leak as text.
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Extract the visible body fragment from CRM outbound wrappers so inbox
 * bubbles don't render the full HTML document / marketing chrome.
 */
export function extractCrmEmailInnerHtml(html) {
  const raw = String(html || '')
  if (!raw.trim()) return null

  // Marketing / designed wrap: content lives in .crm-email-pad
  const padMatch = raw.match(
    /class=["']crm-email-pad["'][^>]*>([\s\S]*?)<\/td>\s*<\/tr>\s*<\/table>/i,
  )
  if (padMatch?.[1] != null) return padMatch[1].trim()

  // Plain compose wrap: full document with <body>…</body>
  if (/<html[\s>]/i.test(raw) || /<!doctype/i.test(raw)) {
    const bodyMatch = raw.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
    if (bodyMatch?.[1] != null) {
      let inner = bodyMatch[1]
        .replace(/<img[^>]*crm-email-open-pixel[^>]*>/gi, '')
        .trim()
      // Unwrap the single outer left-aligned div from the plain layout helper.
      const singleDiv = inner.match(/^<div\b[^>]*>([\s\S]*)<\/div>\s*$/i)
      if (singleDiv) inner = singleDiv[1].trim()
      return inner
    }
  }

  return null
}

/**
 * Best plain-text body for inbox display. Prefer CRM wrapper inner content so
 * outbound chrome / head CSS never appear in the bubble.
 */
export function emailBodyToPlainText(html) {
  const raw = String(html || '')
  if (!raw.trim()) return ''
  const inner = extractCrmEmailInnerHtml(raw)
  return htmlToPlainText(inner != null ? inner : raw)
}

export function mapEmailHistoryRecord(rec, contactName = null) {
  const lead = rec.leadID
  const status = String(rec?.status || '').toLowerCase()
  const isInbound = status === 'received' || status === 'inbound'
  // Inbound: lead wrote to the studio. Outbound: studio wrote to the lead.
  const leadEmail = normalizeEmailAddress(lead?.email || (isInbound ? rec.from : rec.to) || '')
  const rawBody = rec.body || ''
  const leadName =
    (lead?.name && String(lead.name).trim()) ||
    (contactName && String(contactName).trim()) ||
    leadEmail ||
    'Contact'

  return {
    id: rec._id,
    sender: isInbound ? leadName : 'You',
    direction: isInbound ? 'inbound' : 'outbound',
    content: emailBodyToPlainText(rawBody) || htmlToPlainText(rawBody) || rawBody,
    contentHtml: rawBody,
    subject: rec.subject || '',
    timestamp: rec.sentAt || rec.scheduledAt || rec.createdAt,
    channel: 'Email',
    status: rec.status,
    recipientEmail: leadEmail || normalizeEmailAddress(rec.to || rec.email || ''),
    from: rec.from || '',
    to: rec.to || '',
  }
}

export function normalizeEmailAddress(email) {
  return String(email || '').trim().toLowerCase()
}

export function conversationKeyForEmailRecord(rec) {
  const lead = rec.leadID
  if (lead?._id) return `lead-${lead._id}`
  const status = String(rec?.status || '').toLowerCase()
  const isInbound = status === 'received' || status === 'inbound'
  const email = lead?.email || (isInbound ? rec.from : rec.to) || rec.email || ''
  if (email) return `email-${String(email).replace(/\W/g, '_')}`
  return null
}

/** Deduplicate thread messages by id (and channel, so collisions across types are safe). */
export function dedupeThreadMessages(messages) {
  const seen = new Set()
  return messages.filter((m) => {
    const key = `${m?.channel || 'msg'}:${String(m?.id ?? '')}`
    if (!m?.id || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Index email history records by lead conv id and by recipient email. */
export function indexEmailHistoryRecords(emailRecords) {
  const byLeadId = {}
  const byEmail = {}

  for (const rec of emailRecords) {
    const mapped = mapEmailHistoryRecord(rec)
    const lead = rec.leadID
    const status = String(rec?.status || '').toLowerCase()
    const isInbound = status === 'received' || status === 'inbound'
    const email = normalizeEmailAddress(
      lead?.email || (isInbound ? rec.from : rec.to) || rec.email || '',
    )

    if (lead?._id) {
      const key = `lead-${lead._id}`
      if (!byLeadId[key]) byLeadId[key] = []
      byLeadId[key].push(mapped)
    }
    if (email) {
      if (!byEmail[email]) byEmail[email] = []
      byEmail[email].push(mapped)
    }
  }

  for (const key of Object.keys(byLeadId)) {
    byLeadId[key] = dedupeThreadMessages(byLeadId[key]).sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    )
  }
  for (const key of Object.keys(byEmail)) {
    byEmail[key] = dedupeThreadMessages(byEmail[key]).sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
    )
  }

  return { byLeadId, byEmail }
}

export function emailsForConversation(convId, contactEmail, index) {
  const { byLeadId, byEmail } = index
  const fromLead = convId.startsWith('lead-') ? byLeadId[convId] || [] : []
  const normalized = normalizeEmailAddress(contactEmail)
  const fromEmail = normalized ? byEmail[normalized] || [] : []
  return dedupeThreadMessages([...fromLead, ...fromEmail]).sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  )
}
