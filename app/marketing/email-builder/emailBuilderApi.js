/**
 * Normalizers for /api/email/builder and /api/emailHistory responses.
 */

import { getApiBaseUrl } from '@/lib/api'
import { getToken, getEffectiveBranch } from '@/lib/auth'
import { parseScopedTemplateList } from '@/lib/template-scope'

export function extractCategoriesList(result) {
  const payload = result?.data
  const list = Array.isArray(payload?.categories)
    ? payload.categories
    : Array.isArray(payload)
    ? payload
    : []
  return Array.isArray(list) ? list : []
}

export function extractEmailTemplatesPayload(result) {
  const parsed = parseScopedTemplateList(result?.data, 'emails')
  return {
    hasBuckets: parsed.hasBuckets,
    ownTemplates: parsed.ownTemplates,
    orgDefaultTemplates: parsed.orgDefaultTemplates,
    globalTemplates: parsed.globalTemplates,
    list: parsed.list,
    total: parsed.total,
    totalPages: parsed.totalPages,
  }
}

/** Used by StylePanel / form-builder / SMS — not email templates. */
export function extractLeadReasonsList(result) {
  const payload = result?.data
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.reasons)
    ? payload.reasons
    : Array.isArray(payload?.data?.reasons)
    ? payload.data.reasons
    : []
  return Array.isArray(list) ? list : []
}

export function getTemplateCategoryId(template) {
  if (!template?.categoryID) return ''
  if (typeof template.categoryID === 'object') return template.categoryID._id || ''
  return String(template.categoryID)
}

export function getTemplateCategoryName(template) {
  if (!template?.categoryID) return null
  if (typeof template.categoryID === 'object') return template.categoryID.name || null
  return null
}

/**
 * Prefer the API origin only when developing against localhost.
 * In production, keep the backend's PUBLIC_API_BASE_URL so sent emails stay reachable.
 */
function normalizeUploadedMediaUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return raw
  try {
    const media = new URL(raw)
    if (!media.pathname.includes('/public/email-media/')) return raw
    const api = new URL(getApiBaseUrl())
    const isLocalApi =
      api.hostname === 'localhost' ||
      api.hostname === '127.0.0.1' ||
      api.hostname === '::1'
    if (!isLocalApi) return raw
    if (media.origin === api.origin) return raw
    return `${api.origin}${media.pathname}${media.search}`
  } catch {
    return raw
  }
}

/** Normalize pasted media/link URLs to absolute http(s). */
export function normalizeExternalMediaUrl(value) {
  let raw = String(value || '').trim()
  if (!raw) return ''
  if (raw.startsWith('//')) raw = `https:${raw}`
  if (!/^https?:\/\//i.test(raw) && /^[\w.-]+\.[a-z]{2,}/i.test(raw)) {
    raw = `https://${raw}`
  }
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
    return u.toString()
  } catch {
    return ''
  }
}

function mediaAuthHeaders({ json = false } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const branch = getEffectiveBranch()
  if (branch) headers['x-location-id'] = branch
  if (json) headers['Content-Type'] = 'application/json'
  return headers
}

/**
 * Upload an image for email HTML (multipart to /api/email/builder/media).
 * @param {File} file
 * @param {{ replaceUrl?: string }} [options] — previous managed media URL to delete after upload
 * @returns {{ success: boolean, url?: string, error?: string }}
 */
export async function uploadEmailMedia(file, options = {}) {
  if (!file) return { success: false, error: 'No file selected' }

  const form = new FormData()
  form.append('file', file)
  const replaceUrl = String(options?.replaceUrl || '').trim()
  if (replaceUrl) form.append('replaceUrl', replaceUrl)

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/email/builder/media`, {
      method: 'POST',
      headers: mediaAuthHeaders(),
      body: form,
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success) {
      return {
        success: false,
        error: data?.message || data?.error || `Upload failed (${response.status})`,
      }
    }
    const url = normalizeUploadedMediaUrl(data?.data?.url)
    if (!url) return { success: false, error: 'Upload succeeded but no URL was returned' }
    return { success: true, url, filename: data?.data?.filename }
  } catch (error) {
    return { success: false, error: error?.message || 'Network error' }
  }
}

/**
 * Delete a managed email-media image from S3 (no-op for external URLs).
 * @returns {{ success: boolean, deleted?: boolean, error?: string }}
 */
export async function deleteEmailMedia(url) {
  const target = String(url || '').trim()
  if (!target) return { success: true, deleted: false }
  if (!target.includes('/email-media/')) return { success: true, deleted: false }

  try {
    const response = await fetch(`${getApiBaseUrl()}/api/email/builder/media`, {
      method: 'DELETE',
      headers: mediaAuthHeaders({ json: true }),
      body: JSON.stringify({ url: target }),
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.success) {
      return {
        success: false,
        error: data?.message || data?.error || `Delete failed (${response.status})`,
      }
    }
    return { success: true, deleted: Boolean(data?.data?.deleted) }
  } catch (error) {
    return { success: false, error: error?.message || 'Network error' }
  }
}

function escapeHtmlAttr(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

/** Extract YouTube video id from common URL shapes. */
export function extractYoutubeId(url) {
  const raw = String(url || '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.hostname.includes('youtu.be')) {
      return u.pathname.replace(/^\//, '').split('/')[0] || null
    }
    if (u.hostname.includes('youtube.com') || u.hostname.includes('youtube-nocookie.com')) {
      if (u.searchParams.get('v')) return u.searchParams.get('v')
      const parts = u.pathname.split('/').filter(Boolean)
      const embedIdx = parts.indexOf('embed')
      if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1]
      const shortsIdx = parts.indexOf('shorts')
      if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1]
    }
  } catch {
    return null
  }
  return null
}

/** Extract Vimeo video id from common URL shapes. */
export function extractVimeoId(url) {
  const raw = String(url || '').trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (!u.hostname.includes('vimeo.com')) return null
    const parts = u.pathname.split('/').filter(Boolean)
    // vimeo.com/123456789 or vimeo.com/video/123456789
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      if (/^\d{6,}$/.test(parts[i])) return parts[i]
    }
  } catch {
    return null
  }
  return null
}

/**
 * Absolute URL for the shared video play icon used in outbound email HTML.
 * Must be publicly reachable (no auth) so Gmail/Apple Mail can load it.
 */
export function getEmailPlayButtonUrl() {
  const base = String(getApiBaseUrl() || '')
    .trim()
    .replace(/\/$/, '')
  if (!base) return ''
  return `${base}/public/email-assets/play-button.png`
}

/**
 * Email-safe video block: fluid full-width thumbnail with a simple PNG play icon
 * centered on the poster (no emoji / unicode glyphs — those render poorly in Gmail).
 */
export function buildVideoEmailHtml(videoUrl, posterUrl = '', style = '') {
  const href = normalizeExternalMediaUrl(videoUrl)
  const styleAttr = style ? ` style="${escapeHtmlAttr(style)}"` : ' style="text-align:center;margin:16px 0;"'
  if (!href) {
    return `<div${styleAttr}><p style="margin:0;color:#64748b;font-size:14px;text-align:center;">[Invalid video URL]</p></div>`
  }

  const yt = extractYoutubeId(href)
  const vimeo = extractVimeoId(href)
  const poster =
    normalizeExternalMediaUrl(posterUrl) ||
    (yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : '') ||
    (vimeo ? `https://vumbnail.com/${vimeo}.jpg` : '')
  const safeHref = escapeHtmlAttr(href)
  const safePoster = escapeHtmlAttr(poster)
  const playIconUrl = getEmailPlayButtonUrl()
  const safePlayIcon = escapeHtmlAttr(playIconUrl)

  // Simple centered PNG icon — reliable across Gmail / Apple Mail / Outlook.
  const playButton = safePlayIcon
    ? `<img src="${safePlayIcon}" width="64" height="64" alt="Play" data-crm-play="1" style="display:inline-block;width:64px;height:64px;border:0;outline:none;text-decoration:none;max-width:64px;" />`
    : ''

  // The poster is used as a CSS background-image on the <td> (via bgAttr + cellStyle).
  // No separate <img> for the poster — that caused it to render twice (once as a plain
  // image, once as the video tile background). The <table width="100%"> and <td width="100%">
  // HTML attributes are sufficient to force full width in Gmail Android without a width-driver.
  // Fixed pixel padding (100px) avoids Gmail stripping %-based padding.
  // poster is auto-populated from YouTube/Vimeo when no custom thumbnail is uploaded.
  const bgAttr = safePoster ? ` background="${safePoster}"` : ''
  const cellStyle = safePoster
    ? `width:100%;max-width:100%;background-image:url(&quot;${safePoster}&quot;);background-repeat:no-repeat;background-position:center center;background-size:cover;background-color:#0f172a;border-radius:8px;`
    : 'width:100%;max-width:100%;background-color:#0f172a;border-radius:8px;'

  return [
    `<div data-crm-video="1"${styleAttr}>`,
    `<a href="${safeHref}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;color:#ffffff;display:block;width:100%;max-width:100%;">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;max-width:100%;">',
    '<tr>',
    `<td${bgAttr} bgcolor="#0f172a" width="100%" align="center" valign="middle" style="${cellStyle}">`,
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;width:100%;"><tr>',
    `<td align="center" valign="middle" style="padding:100px 16px;">${playButton}</td>`,
    '</tr></table>',
    '</td>',
    '</tr>',
    '</table>',
    '</a>',
    '</div>',
  ].join('')
}

/**
 * Normalize image/video shells in stored template HTML for mobile clients.
 * Kept in sync with backend ensureFluidMediaInHtml.
 */
export function ensureFluidEmailMedia(html) {
  let out = String(html || '')
  if (!out.trim()) return out

  out = out.replace(/<img\b([^>]*)>/gi, (full, attrs) => {
    if (/\bwidth\s*=\s*["']?1["']?/i.test(attrs) && /\bheight\s*=\s*["']?1["']?/i.test(attrs)) {
      return full
    }
    if (/\bdata-crm-play\b/i.test(attrs) || /email-assets\/play-button/i.test(attrs)) {
      return full
    }
    if (/\bdata-crm-spacer\b/i.test(attrs)) {
      return full
    }
    let a = String(attrs || '').replace(/\s*\/\s*$/, '')
    const forceFull = /\bdata-crm-img\s*=\s*(["']?)1\1(?=[\s/>]|$)/i.test(a)

    const mergeStyle = (style) => {
      let s = String(style || '').trim().replace(/;?\s*$/, '')
      if (!/max-width\s*:/i.test(s)) s = s ? `${s};max-width:100%` : 'max-width:100%'
      if (!/height\s*:\s*auto/i.test(s)) s += ';height:auto'
      if (!/display\s*:/i.test(s)) s += ';display:block'
      if (!/border\s*:/i.test(s)) s += ';border:0'
      if (forceFull && !/(^|;)\s*width\s*:\s*100%\s*(;|$)/i.test(s)) s += ';width:100%'
      return s
    }

    if (/style\s*=\s*(["'])([\s\S]*?)\1/i.test(a)) {
      a = a.replace(/style\s*=\s*(["'])([\s\S]*?)\1/i, (_, q, style) => `style=${q}${mergeStyle(style)}${q}`)
    } else {
      a += ` style="${mergeStyle('')}"`
    }
    if (forceFull && !/\bwidth\s*=/i.test(a)) a += ' width="720"'
    return `<img${a}>`
  })

  return out
}
