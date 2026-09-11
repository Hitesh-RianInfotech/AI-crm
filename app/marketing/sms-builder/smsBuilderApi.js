/**
 * Normalizers for /api/smsBuilder responses.
 */

import { parseScopedTemplateList } from '@/lib/template-scope'

export function extractSmsCategoriesList(result) {
  const payload = result?.data
  const list = Array.isArray(payload?.categories)
    ? payload.categories
    : Array.isArray(payload)
      ? payload
      : []
  return Array.isArray(list) ? list : []
}

export function extractSmsTemplatesPayload(result) {
  return parseScopedTemplateList(result?.data, 'smsList')
}

export function extractSmsTemplateDetail(result) {
  const tpl = result?.data?.sms ?? result?.data
  return tpl && typeof tpl === 'object' ? tpl : null
}

export function getSmsTemplateCategoryName(template) {
  if (!template?.categoryID) return null
  if (typeof template.categoryID === 'object') return template.categoryID.name || null
  return null
}
