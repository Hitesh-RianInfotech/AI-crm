'use client'

import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { sanitizeStatusHex } from '@/lib/status-hex'

/**
 * Static fallback list — used as the initial value and for SSR-safe code paths.
 * Once useLeadStages() resolves from the API, org-specific statuses take over.
 * Keep in sync with DEFAULT_LEAD_STATUSES in leadStatusSeed.service.js.
 */
export const LEAD_STAGE_VALUES = [
  'new',
  'engaged',
  'pending_payment',
  'declined',
  'dormant',
  'converted',
  'human intervention',
  're_engaged',
  'cold',
]

/** Default hex colors — keep in sync with DEFAULT_LEAD_STATUSES in leadStatusSeed.service.js. */
export const LEAD_STAGE_DEFAULT_COLORS = {
  new: '#6B7280',
  engaged: '#3B82F6',
  pending_payment: '#F59E0B',
  declined: '#DC2626',
  dormant: '#64748B',
  converted: '#059669',
  'human intervention': '#D97706',
  re_engaged: '#6366F1',
  cold: '#94A3B8',
}

function fallbackStage(value) {
  return {
    value,
    label: formatLeadStageLabel(value),
    key: value,
    name: formatLeadStageLabel(value),
    color: LEAD_STAGE_DEFAULT_COLORS[value],
  }
}

function fallbackStages() {
  return LEAD_STAGE_VALUES.map(fallbackStage)
}

/** Tailwind badge classes for the current lead funnel (fallback when API color is missing). */
export const LEAD_STAGE_BADGE_STYLES = {
  new: 'bg-muted text-foreground',
  engaged: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  pending_payment: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  declined: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
  dormant: 'bg-muted text-foreground',
  converted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  'human intervention': 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  re_engaged: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  cold: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
}

const DEFAULT_BADGE_CLASS = 'bg-muted text-foreground'

/**
 * Resolve a badge class for a lead stage key.
 * Prefers known current-funnel styles; unknown/legacy keys get a neutral fallback.
 */
export function getLeadStageBadgeClass(stageKey) {
  const key = String(stageKey || 'new').trim().toLowerCase()
  return LEAD_STAGE_BADGE_STYLES[key] ?? DEFAULT_BADGE_CLASS
}

/** Hex from Stages & Lifecycle (org API), then the seeded default. */
export function getLeadStageColor(stageKey, stages) {
  const key = String(stageKey || 'new').trim().toLowerCase()
  if (Array.isArray(stages)) {
    const match = stages.find(
      (s) => String(s.key || s.value || '').trim().toLowerCase() === key
    )
    const fromOrg = sanitizeStatusHex(match?.color)
    if (fromOrg) return fromOrg
  }
  return sanitizeStatusHex(LEAD_STAGE_DEFAULT_COLORS[key] || '')
}

export function getLeadStageBadgeProps(stageKey, stages) {
  const color = getLeadStageColor(stageKey, stages)
  if (color) {
    return { className: 'status-color-badge', style: { '--status-color': color } }
  }
  return { className: getLeadStageBadgeClass(stageKey), style: undefined }
}

/** @deprecated Prefer useLeadStages() — kept as an alias for existing imports. */
export const STAGE_OPTIONS = LEAD_STAGE_VALUES

/** @deprecated Prefer useLeadStages() — kept as an alias for existing imports. */
export const LEAD_STAGE_OPTIONS = LEAD_STAGE_VALUES

/** @deprecated Prefer useLeadStages() — kept as an alias for existing imports. */
export const CAMPAIGN_LEAD_STAGE_OPTIONS = LEAD_STAGE_VALUES

/**
 * Display label for a stage key.
 * Prefers the org name from a stages array; falls back to title-casing the key.
 * This means orphaned legacy keys (e.g. "actualized") still render gracefully.
 */
export function formatLeadStageLabel(value, stages) {
  if (value === null || value === undefined) return ''
  const str = String(value).trim()
  if (!str) return ''
  if (Array.isArray(stages)) {
    const match = stages.find((s) => s.key === str || s.value === str)
    if (match?.name) return match.name
  }
  return str
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Returns static dropdown options from LEAD_STAGE_VALUES.
 * @deprecated Use useLeadStages() for org-specific options.
 */
export function getLeadStageOptions() {
  return LEAD_STAGE_VALUES.map((value) => ({
    value,
    label: formatLeadStageLabel(value),
  }))
}

// Module-level cache so multiple hooks on the same page share one fetch.
let _cache = null
let _cachePromise = null

function fetchFromApi() {
  if (_cache) return Promise.resolve(_cache)
  if (_cachePromise) return _cachePromise
  _cachePromise = api
    .get('/api/lead-status?active=true')
    .then((res) => {
      if (res?.success && Array.isArray(res.data)) {
        _cache = res.data.map((s) => ({
          value: s.key,
          label: s.name,
          key: s.key,
          name: s.name,
          color: s.color,
          description: s.description,
          sortOrder: s.sortOrder,
          isActive: s.isActive,
          isDefault: s.isDefault,
        }))
      } else {
        _cache = fallbackStages()
      }
      _cachePromise = null
      return _cache
    })
    .catch(() => {
      _cachePromise = null
      return fallbackStages()
    })
  return _cachePromise
}

/**
 * Invalidate the lead stage cache (call after creating/updating/deleting a status).
 */
export function invalidateLeadStagesCache() {
  _cache = null
  _cachePromise = null
}

/**
 * React hook that returns org-specific lead stage options.
 * Returns `{ stages, loading }` where stages is `{ value, label, key, name, color, ... }[]`.
 * Falls back to LEAD_STAGE_VALUES on error or during SSR.
 */
export function useLeadStages() {
  const [stages, setStages] = useState(() => _cache ?? fallbackStages())
  const [loading, setLoading] = useState(!_cache)

  useEffect(() => {
    if (_cache) {
      setStages(_cache)
      setLoading(false)
      return
    }
    setLoading(true)
    fetchFromApi().then((result) => {
      setStages(result)
      setLoading(false)
    })
  }, [])

  return { stages, loading }
}
