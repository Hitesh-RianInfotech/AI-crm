'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { Plus, FileText, BarChart3, Eye, Copy, Trash2, Sparkles, GripVertical, Type, Mail, Phone, CheckSquare, Calendar, ChevronDown, Paperclip, Star, Download, Heart, X, ArrowLeft, LayoutTemplate, UserRound, Search, MapPin, Megaphone, Hash, Heading, ShieldCheck, Image, Volume2, Calculator, EyeOff, Link2, Code2, ExternalLink } from 'lucide-react'
import SearchInput from '@/components/ui/search-input'
import MainLayout from '@/components/layout/MainLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import api, { getApiBaseUrl } from '@/lib/api'
import { buildFormEmbedCode, buildFormShareLink } from '@/lib/form-embed'
import { useToast } from '@/components/ui/toast'
import Switch from '@/components/ui/switch'
import { formatDate, cn } from '@/lib/utils'
import StylePanel from '@/components/forms/StylePanel'
import GlobalStylePanel from '@/components/forms/GlobalStylePanel'
import GlobalLoader from '@/components/shared/GlobalLoader'
import { getCurrentUser, getEffectiveBranch } from '@/lib/auth'
import { canManageDefaultWorkflows, hasPermission, isSuperAdmin } from '@/lib/permissions'
import LocationSelector, { ALL_BRANCHES_VALUE } from '@/components/shared/LocationSelector'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import SetTemplateScopeDialog from '@/components/templates/SetTemplateScopeDialog'
import {
  parseScopedTemplateList,
  templateScopeBadge,
  templateScopeVariant,
} from '@/lib/template-scope'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { extractLeadReasonsList } from '../email-builder/emailBuilderApi'
import { SOURCE_OPTIONS } from '@/lib/dynamic-list-constants'
import { formatReasonLabel } from '@/lib/dynamic-list-normalize'
import {
  DynamicCaptcha,
  getCaptchaExportMarkup,
  getCaptchaExportRuntimeScript,
} from '@/components/forms/DynamicCaptcha'
import {
  DEFAULT_PHONE_COUNTRY_CODE,
  DEFAULT_PHONE_COUNTRY_ISO,
} from '@/lib/phone-country-codes'
import { buildHeadingBoxStyle, buildHeadingTextStyle, resolveHeadingTag } from '@/lib/form-heading-styles'
import {
  embedGlobalStylesMeta,
  parseGlobalStylesMeta,
  mergeFieldStyles,
  isExcludedFromGlobalStyles,
  buildLabelReactStyle,
  buildInputReactStyle,
  buildInputCssString,
  buildLabelCssString,
  resolveFormBackground,
  buildFormContainerCss,
  buildFormPageCss,
} from '@/lib/form-global-styles'
import FormPhoneInput, {
  getFormPhoneExportMarkup,
  getFormPhoneExportRuntimeScript,
} from '@/components/forms/FormPhoneInput'

const UTM_SOURCE_FIELD_OPTIONS = SOURCE_OPTIONS.map((value) => ({
  value,
  label: value === 'google-add' ? 'Google Ads' : value === 'website' ? 'Website' : value,
}))

/** Lead schema properties available in the builder. `name` is the fixed submit key. */
const LEAD_PROPERTIES = [
  {
    id: 'name',
    name: 'name',
    label: 'Name',
    type: 'text',
    placeholder: 'Enter your name',
    icon: Type,
    frequentlyUsed: true,
  },
  {
    id: 'email',
    name: 'email',
    label: 'Email',
    type: 'email',
    placeholder: 'you@email.com',
    icon: Mail,
    frequentlyUsed: true,
  },
  {
    id: 'phoneNumber',
    name: 'phoneNumber',
    label: 'Phone Number',
    type: 'phone',
    placeholder: 'Phone number',
    icon: Phone,
    frequentlyUsed: true,
    defaultCountryCode: DEFAULT_PHONE_COUNTRY_CODE,
    defaultCountryIso: DEFAULT_PHONE_COUNTRY_ISO,
  },
  {
    id: 'locationID',
    name: 'locationID',
    label: 'Studio',
    type: 'select',
    placeholder: 'Select studio',
    icon: MapPin,
    optionsFrom: 'locations',
    frequentlyUsed: true,
  },
  {
    id: 'reason',
    name: 'reason',
    label: 'Reason',
    type: 'select',
    placeholder: 'Select Reason',
    icon: Hash,
    optionsFrom: 'reasons',
    frequentlyUsed: true,
  },
  {
    id: 'location',
    name: 'location',
    label: 'Location',
    type: 'text',
    placeholder: 'City or location text',
    icon: MapPin,
    frequentlyUsed: false,
  },
  {
    id: 'utm_source',
    name: 'utm_source',
    label: 'Source',
    type: 'select',
    placeholder: 'Select source',
    icon: Megaphone,
    options: UTM_SOURCE_FIELD_OPTIONS,
    frequentlyUsed: false,
  },
]

const LEAD_PROPERTY_NAMES = new Set(LEAD_PROPERTIES.map((p) => p.name))
const CORE_LEAD_PROPERTY_NAMES = ['name', 'email', 'phoneNumber', 'locationID', 'reason']

const fieldTypes = [
  { id: 'text', name: 'Text Input', icon: Type },
  { id: 'email', name: 'Email', icon: Mail },
  { id: 'phone', name: 'Phone', icon: Phone },
  { id: 'textarea', name: 'Text Area', icon: FileText },
  { id: 'checkbox', name: 'Checkbox', icon: CheckSquare },
  { id: 'date', name: 'Date Picker', icon: Calendar },
  { id: 'select', name: 'Dropdown', icon: ChevronDown },
  { id: 'file', name: 'File Upload', icon: Paperclip },
  { id: 'rating', name: 'Rating', icon: Star },
]

/** Field types offered when adding a custom (metadata) property */
const CUSTOM_FIELD_TYPES = [
  { id: 'text', name: 'Text Input', icon: Type },
  { id: 'textarea', name: 'Text Area', icon: FileText },
  { id: 'checkbox', name: 'Checkbox', icon: CheckSquare },
  { id: 'date', name: 'Date Picker', icon: Calendar },
  { id: 'select', name: 'Dropdown', icon: ChevronDown },
  { id: 'file', name: 'File Upload', icon: Paperclip },
  { id: 'rating', name: 'Rating', icon: Star },
]

/** Always-available layout / form elements (not lead properties) */
const FORM_ELEMENTS = [
  {
    id: 'heading',
    type: 'heading',
    name: 'Heading',
    label: 'Heading',
    icon: Heading,
  },
]

/** Captcha variants — pick one when adding Captcha */
const CAPTCHA_TYPES = [
  { id: 'images', name: 'Images', label: 'Select the matching images', icon: Image },
  { id: 'robot', name: "I'm not a robot", label: "I'm not a robot", icon: ShieldCheck },
  { id: 'audio', name: 'Audio', label: 'Listen and type the code', icon: Volume2 },
  { id: 'math', name: 'Math-based', label: 'Solve the math problem', icon: Calculator },
  { id: 'invisible', name: 'Invisible / Score-based', label: 'Protected by invisible captcha', icon: EyeOff },
  { id: 'text', name: 'Text-based', label: 'Enter the characters you see', icon: Type },
]

function getCaptchaTypeMeta(captchaType) {
  return CAPTCHA_TYPES.find((t) => t.id === captchaType) || CAPTCHA_TYPES.find((t) => t.id === 'robot')
}

function createCaptchaField(captchaType = 'robot') {
  const meta = getCaptchaTypeMeta(captchaType)
  return {
    id: `captcha-${Date.now()}`,
    type: 'captcha',
    name: 'captcha',
    captchaType: meta.id,
    label: meta.label,
    placeholder: '',
    required: true,
    propertyKind: 'layout',
    styles: {},
  }
}

const templateFields = {
  f1: [
    { id: 't1', type: 'text', label: 'Student Name', placeholder: 'Full name', required: true },
    { id: 't2', type: 'email', label: 'Parent Email', placeholder: 'parent@email.com', required: true },
    { id: 't3', type: 'phone', label: 'Phone Number', placeholder: '(555) 123-4567', required: true },
    { id: 't4', type: 'date', label: 'Date of Birth', placeholder: '', required: true },
  ],
  f2: [
    { id: 't1', type: 'text', label: 'Student Name', placeholder: 'Full name', required: true },
    { id: 't2', type: 'email', label: 'Email', placeholder: 'you@email.com', required: true },
    { id: 't3', type: 'select', label: 'Class Type', placeholder: '', required: true },
  ],
  f3: [
    { id: 't1', type: 'text', label: 'Parent Name', placeholder: 'Full name', required: true },
    { id: 't2', type: 'checkbox', label: 'Liability Consent', placeholder: 'I agree to the terms', required: true },
  ],
  f4: [
    { id: 't1', type: 'rating', label: 'Overall Rating', placeholder: '', required: true },
    { id: 't2', type: 'textarea', label: 'Feedback', placeholder: 'Share your feedback', required: false },
  ],
}

function buildReasonOptions(leadReasons = []) {
  return (leadReasons || []).map((r) => {
    const value = r.reasonCode || r._id || r.name
    return {
      label: formatReasonLabel(value, leadReasons),
      value,
    }
  })
}

function cloneReasonOptions(options = []) {
  return sanitizeReasonOptions(options).map((o) => ({
    value: o.value,
    label: o.label || formatReasonLabel(o.value),
  }))
}

function getReasonOptionsFromFields(fields = []) {
  const reasonField = (fields || []).find((f) => f?.name === 'reason')
  return cloneReasonOptions(reasonField?.options)
}

function buildStudioOptions(locations = []) {
  return (locations || []).map((loc) => ({
    label: loc.name || 'Unnamed location',
    value: String(loc._id),
  }))
}

/** Studio IDs this form is scoped to (empty = not constrained / all). */
function resolveFormStudioScopeIds(formLocationID) {
  if (formLocationID === ALL_BRANCHES_VALUE) return []
  if (Array.isArray(formLocationID)) {
    return formLocationID.map(String).filter(Boolean)
  }
  if (formLocationID && formLocationID !== ALL_BRANCHES_VALUE) {
    return [String(formLocationID)]
  }
  const branch = getEffectiveBranch()
  return branch ? [String(branch)] : []
}

/**
 * Studio field options: when a navbar branch (or specific form studios) is set,
 * only those studios appear — not the full org list.
 */
function buildStudioOptionsForForm(locations = [], formLocationID) {
  const all = buildStudioOptions(locations)
  if (formLocationID === ALL_BRANCHES_VALUE) return all
  const scopeIds = resolveFormStudioScopeIds(formLocationID)
  if (!scopeIds.length) return all
  const scoped = all.filter((o) => scopeIds.includes(String(o.value)))
  return scoped.length ? scoped : all
}

/** Studio used when loading/creating lead reasons for the form builder. */
function resolveReasonsLocationID(formLocationID) {
  if (
    formLocationID &&
    formLocationID !== ALL_BRANCHES_VALUE &&
    Array.isArray(formLocationID) &&
    formLocationID.length === 1
  ) {
    return String(formLocationID[0])
  }
  if (
    formLocationID &&
    formLocationID !== ALL_BRANCHES_VALUE &&
    typeof formLocationID === 'string'
  ) {
    return String(formLocationID)
  }
  const branch = getEffectiveBranch()
  if (branch) return String(branch)
  if (Array.isArray(formLocationID) && formLocationID.length > 0) {
    return String(formLocationID[0])
  }
  return null
}

function leadReasonsUrl(locationID) {
  if (!locationID) return '/api/lead-reasons'
  return `/api/lead-reasons?locationID=${encodeURIComponent(locationID)}`
}

function resolvePropertyOptions(prop, leadReasons = [], locations = []) {
  if (prop.options) return prop.options
  if (prop.optionsFrom === 'locations') return buildStudioOptions(locations)
  if (prop.optionsFrom === 'reasons') return buildReasonOptions(leadReasons)
  return []
}

function createLeadPropertyField(prop, { leadReasons = [], locations = [], locked = false, required = false, formLocationID } = {}) {
  const options =
    prop?.name === 'locationID'
      ? buildStudioOptionsForForm(locations, formLocationID)
      : resolvePropertyOptions(prop, leadReasons, locations)
  const scopeIds = prop?.name === 'locationID' ? resolveFormStudioScopeIds(formLocationID) : []
  const branch = getEffectiveBranch()
  const studioDefault =
    prop?.name === 'locationID'
      ? scopeIds.length === 1
        ? scopeIds[0]
        : branch && options.some((o) => String(o.value) === String(branch))
          ? String(branch)
          : options.length === 1
            ? String(options[0].value)
            : undefined
      : undefined
  return {
    id: `lead-${prop.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: prop.type,
    name: prop.name,
    label: prop.label,
    placeholder: prop.placeholder || '',
    required,
    locked,
    propertyKind: 'lead',
    styles: {},
    options: prop.type === 'select' || prop.type === 'checkbox' ? options : undefined,
    optionsLocked: prop.name === 'reason' ? false : Boolean(prop.options || prop.optionsFrom),
    ...(studioDefault
      ? { defaultValue: studioDefault, studioDefaultSeeded: true }
      : {}),
    ...(prop.defaultCountryCode ? { defaultCountryCode: prop.defaultCountryCode } : {}),
    ...(prop.defaultCountryIso ? { defaultCountryIso: prop.defaultCountryIso } : {}),
  }
}

function createMetadataField(type = 'text', label = 'Custom field') {
  const typeMeta = CUSTOM_FIELD_TYPES.find((t) => t.id === type) || CUSTOM_FIELD_TYPES[0]
  const keyBase = String(label || typeMeta.name || 'custom_field')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'custom_field'
  const metadataKey = `${keyBase}_${Date.now().toString(36).slice(-4)}`
  return {
    id: `meta-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: typeMeta.id,
    name: `metadata.${metadataKey}`,
    metadataKey,
    label,
    placeholder: typeMeta.id === 'select' || typeMeta.id === 'checkbox' ? '' : 'Enter value…',
    required: false,
    locked: false,
    propertyKind: 'metadata',
    styles: {},
    options:
      typeMeta.id === 'select' || typeMeta.id === 'checkbox'
        ? [{ label: 'Option 1', value: 'option_1' }]
        : undefined,
  }
}

function buildRequiredLeadFields(leadReasons = [], locations = []) {
  return CORE_LEAD_PROPERTY_NAMES.map((name) => {
    const prop = LEAD_PROPERTIES.find((p) => p.name === name)
    const field = createLeadPropertyField(prop, {
      leadReasons,
      locations,
      locked: true,
      required: true,
    })
    // Stable ids for core required fields (easier option sync / import)
    field.id = `req-${name === 'locationID' ? 'studio' : name}`
    return field
  })
}

const REQUIRED_SYSTEM_FIELDS = [
  { id: 'sys-organisationID', type: 'hidden', name: 'organisationID', label: 'organisationID', hidden: true, locked: true, styles: {} },
  { id: 'sys-formID', type: 'hidden', name: 'formID', label: 'formID', hidden: true, locked: true, styles: {} },
]

const FORM_TYPE_OPTIONS = [
  {
    id: 'blank',
    title: 'Blank',
    description: 'Start with an empty form and add your own fields from scratch.',
    icon: Plus,
  },
  {
    id: 'lead',
    title: 'Lead form',
    description: 'Includes required lead fields (name, email, phone, studio, reason). Add Source, Location, or metadata from the sidebar.',
    icon: UserRound,
  },
]

function buildInitialFormFields(formType, leadReasons = [], locations = []) {
  if (formType === 'lead') {
    return [...REQUIRED_SYSTEM_FIELDS, ...buildRequiredLeadFields(leadReasons, locations)]
  }
  return [...REQUIRED_SYSTEM_FIELDS]
}

function detectFormTypeFromInferred(inferred = []) {
  const names = new Set(inferred.map((f) => f?.name).filter(Boolean))
  const hasLeadCore = ['name', 'email', 'phoneNumber'].every((n) => names.has(n))
  const hasLeadExtras = names.has('reason') || names.has('locationID')
  return hasLeadCore && hasLeadExtras ? 'lead' : 'blank'
}

function escapeHtmlAttr(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function isSystemHiddenField(field) {
  return field?.type === 'hidden' || (field?.hidden && !field?.submitHidden)
}

/** Phone widget helper inputs that must never appear as real builder fields */
const PHONE_WIDGET_JUNK_NAMES = new Set([
  'phonelocal',
  'phonecountrycode',
  'phone_local',
  'phone_country_code',
  'phone-local',
  'phone-country-code',
])

function normalizeFieldKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\[\]$/, '')
}

function isPhoneWidgetJunkField(field) {
  if (!field) return true
  // Layout elements are never phone helpers
  if (field.type === 'heading' || field.type === 'captcha') return false

  const name = normalizeFieldKey(field.name)
  const label = normalizeFieldKey(field.label)
  const placeholder = String(field.placeholder || '')
  const prop = normalizeFieldKey(field.name || field.label || field.id || '')

  if (PHONE_WIDGET_JUNK_NAMES.has(name) || PHONE_WIDGET_JUNK_NAMES.has(label) || PHONE_WIDGET_JUNK_NAMES.has(prop)) {
    return true
  }
  if (/search\s+for\s+countries/i.test(placeholder)) return true
  if (/search\s+for\s+countries/i.test(String(field.label || ''))) return true
  // Nameless / generic leftovers from the country search box
  if (!name && (/^field$/i.test(label) || !label)) return true
  // Phone UI wrongly saved under a helper name
  if (
    (field.type === 'phone' || field.type === 'tel') &&
    name &&
    name !== 'phonenumber' &&
    !name.startsWith('metadata.') &&
    (name.includes('phonelocal') || name.includes('countrycode') || name.includes('phone_local'))
  ) {
    return true
  }
  return false
}

function sanitizeFormFields(fields = []) {
  const cleaned = []
  const seen = new Set()
  for (const field of fields || []) {
    if (!field || isPhoneWidgetJunkField(field)) continue
    const key =
      field.type === 'heading'
        ? `heading:${field.id}`
        : field.type === 'captcha'
          ? 'captcha'
          : normalizeFieldKey(field.name || field.id || '')
    if (key && field.type !== 'heading' && field.type !== 'captcha' && seen.has(key)) continue
    if (key) seen.add(key)
    if (field.name === 'phoneNumber' && field.type !== 'phone') {
      cleaned.push({
        ...field,
        type: 'phone',
        propertyKind: field.propertyKind || 'lead',
      })
      continue
    }
    cleaned.push(field)
  }
  return cleaned
}

function isCanvasField(field) {
  return field && !isSystemHiddenField(field) && !isPhoneWidgetJunkField(field)
}

/** Keep headings above all other visible fields (system hiddens stay first). */
function pinHeadingsToTop(fields = []) {
  const system = []
  const headings = []
  const rest = []
  for (const field of fields || []) {
    if (!field) continue
    if (isSystemHiddenField(field) || field.name === 'organisationID' || field.name === 'formID') {
      system.push(field)
    } else if (field.type === 'heading') {
      headings.push(field)
    } else {
      rest.push(field)
    }
  }
  return [...system, ...headings, ...rest]
}

function FormTypePreview({ formType }) {
  if (formType === 'lead') {
    const previewFields = [
      { label: 'Name', required: true },
      { label: 'Email', required: true },
      { label: 'Phone Number', required: true },
      { label: 'Studio', required: true },
      { label: 'Reason', required: true },
    ]
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {previewFields.map((field, index) => (
          <div
            key={field.label}
            className={cn(
              'border-b border-slate-200 px-5 py-4 last:border-b-0',
              index === 0 && 'bg-sky-50'
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-slate-900">
                {field.label}
                {field.required ? <span>*</span> : null}
              </span>
              <span className="text-xs italic text-slate-400">
                {field.label.toLowerCase().replace(/\s+/g, '')}
              </span>
              <FormFieldTag tone="teal">Lead property</FormFieldTag>
            </div>
            <div className="mt-2.5 h-10 rounded-md border border-slate-300 bg-white" />
          </div>
        ))}
        <div className="border-t border-slate-200 px-5 py-5">
          <div className="inline-flex rounded-full bg-[color:var(--studio-primary)] px-6 py-2.5 text-sm font-semibold text-white">
            Submit
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted">
        <LayoutTemplate className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">Blank form</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Drag components from the sidebar to build your form.
      </p>
    </div>
  )
}

function getFieldPropertyName(field) {
  if (field?.type === 'heading') return 'heading'
  if (field?.type === 'captcha') return 'captcha'
  if (field?.propertyKind === 'metadata' || field?.metadataKey) {
    return `metadata.${field.metadataKey || 'custom'}`
  }
  if (field?.name) return field.name
  return (field?.label || field?.id || 'field')
    .toLowerCase()
    .replace(/\s+/g, '_')
}

function getSelectPlaceholder(field) {
  if (field?.placeholder && String(field.placeholder).trim()) {
    return String(field.placeholder).trim()
  }
  if (field?.name === 'reason') return 'Select Reason'
  if (field?.name === 'locationID') return 'Select studio'
  if (field?.name === 'utm_source') return 'Select source'
  return 'Select an option'
}

/**
 * Thank-you redirects must be absolute. Values like `www.example.com` without a
 * scheme are treated as relative paths by the browser and get appended to the
 * current page URL.
 */
function normalizeStandaloneRedirectUrl(raw) {
  let url = String(raw || '').trim()
  if (!url) return ''

  // If a previous relative resolve already mangled it, prefer the last http(s) URL.
  const embedded = url.match(/https?:\/\/[^\s"']+/gi)
  if (embedded && embedded.length > 1) {
    url = embedded[embedded.length - 1]
  }

  // Recover paths that absorbed a www.* host as a relative segment, e.g.
  // https://site.com/studio/form/www.example.com → https://www.example.com
  const wwwTail = url.match(
    /^(https?:\/\/.+)\/(www\.[a-z0-9.-]+\.[a-z]{2,})(\/.*)?$/i
  )
  if (wwwTail) {
    url = `https://${wwwTail[2]}${wwwTail[3] || ''}`
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  if (url.startsWith('//')) return `https:${url}`
  return `https://${url.replace(/^\/+/, '')}`
}

/** Empty / prompt options like "Select Reason" — not real reason choices. */
function isSelectPlaceholderOption(opt) {
  const value = String(opt?.value ?? '').trim()
  const label = String(opt?.label ?? '').trim()
  if (!value && !label) return true
  const normalized = (value || label).toLowerCase().replace(/\s+/g, ' ')
  return (
    normalized === 'select reason' ||
    normalized === 'select an option' ||
    normalized === 'select studio' ||
    normalized === 'select source' ||
    /^select(\s+\w+)?$/i.test(normalized)
  )
}

function sanitizeReasonOptions(options = []) {
  return (options || []).filter((o) => !isSelectPlaceholderOption(o))
}

function getFieldDefaultDisplayLabel(field) {
  const value = field?.defaultValue
  if (value == null || value === '') return ''
  const str = String(value)
  const options = field?.options || []
  const match = options.find(
    (opt) => String(opt.value ?? '') === str || String(opt.label ?? '') === str
  )
  return match?.label || match?.value || str
}

function FormFieldTag({ children, tone = 'teal' }) {
  const tones = {
    teal: 'border-teal-500/50 bg-teal-50 text-teal-700',
    violet: 'border-violet-500/50 bg-violet-50 text-violet-700',
    slate: 'border-slate-300 bg-slate-50 text-slate-600',
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-[11px] font-medium leading-none',
        tones[tone] || tones.slate
      )}
    >
      {children}
    </span>
  )
}

// Sortable Field Item Component
function SortableFieldItem({ field, isSelected, onSelect, onRemove, globalStyles, globalStyleExcludeKeys }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: field.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
  }

  const excluded = isExcludedFromGlobalStyles(field, globalStyleExcludeKeys)
  const fieldStyles = mergeFieldStyles(globalStyles, field.styles || {}, excluded)
  const propertyName = getFieldPropertyName(field)
  const isLeadProperty =
    field.propertyKind === 'lead' || (field.name && LEAD_PROPERTY_NAMES.has(field.name))
  const isMetadataProperty = field.propertyKind === 'metadata' || Boolean(field.metadataKey)
  const defaultDisplayLabel = getFieldDefaultDisplayLabel(field)

  const inputClassName =
    'w-full rounded-md border border-slate-300 px-3 py-2 shadow-none pointer-events-none'

  const getInputStyle = () => buildInputReactStyle(fieldStyles)
  const getLabelStyle = () => buildLabelReactStyle(fieldStyles)

  const renderFieldControl = () => {
    if (field.type === 'heading') {
      const Tag = resolveHeadingTag(field.headingLevel)
      const text = (field.label || '').trim()
      return (
        <div className="pointer-events-none min-h-[2rem]" style={buildHeadingBoxStyle(fieldStyles)}>
          <Tag
            style={{
              ...buildHeadingTextStyle(fieldStyles),
              ...(text ? null : { opacity: 0.45, fontStyle: 'italic' }),
            }}
          >
            {text || 'Heading'}
          </Tag>
        </div>
      )
    }
    if (field.type === 'captcha') {
      return <DynamicCaptcha field={field} interactive />
    }
    if (field.type === 'textarea') {
      return (
        <textarea
          placeholder={field.placeholder}
          className={cn(inputClassName, 'min-h-[88px] resize-none')}
          style={getInputStyle()}
          rows={3}
          disabled
          readOnly
        />
      )
    }
    if (field.type === 'select') {
      return (
        <select
          className={inputClassName}
          style={getInputStyle()}
          disabled
          defaultValue={field.defaultValue || ''}
        >
          <option value="">{getSelectPlaceholder(field)}</option>
          {(field.options || []).map((opt) => (
            <option key={opt.value || opt.label} value={opt.value || opt.label}>
              {opt.label || opt.value}
            </option>
          ))}
        </select>
      )
    }
    if (field.type === 'checkbox') {
      return (
        <div className="flex flex-col gap-2 py-1">
          {(field.options && field.options.length > 0) ? (
            field.options.map((opt) => (
              <div key={opt.value || opt.label} className="flex items-center gap-2">
                <input type="checkbox" disabled className="h-4 w-4" />
                <span className="text-sm text-slate-600">{opt.label || opt.value}</span>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-2">
              <input type="checkbox" disabled className="h-4 w-4" />
              <span className="text-sm text-slate-600">{field.placeholder || 'Checkbox option'}</span>
            </div>
          )}
        </div>
      )
    }
    if (field.type === 'rating') {
      return (
        <div className="flex gap-1 py-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <span key={star} className="text-2xl text-slate-300">
              ★
            </span>
          ))}
        </div>
      )
    }
    if (field.type === 'phone' || field.name === 'phoneNumber') {
      return (
        <FormPhoneInput
          label={field.label || 'Phone number'}
          required={Boolean(field.required)}
          placeholder={field.placeholder || ''}
          countryCode={field.defaultCountryCode || DEFAULT_PHONE_COUNTRY_CODE}
          countryIso={field.defaultCountryIso || DEFAULT_PHONE_COUNTRY_ISO}
          value={field.defaultValue || ''}
          style={getInputStyle()}
        />
      )
    }
    return (
      <Input
        type={field.type}
        placeholder={field.placeholder}
        defaultValue={field.defaultValue || ''}
        disabled
        readOnly
        className={inputClassName}
        style={getInputStyle()}
      />
    )
  }

  const isLayoutElement = field.type === 'heading' || field.type === 'captcha'

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={() => onSelect(field.id)}
      className={cn(
        'group relative cursor-pointer border-b border-slate-200/60 px-5 py-4 transition-colors last:border-b-0',
        isSelected ? 'bg-sky-500/10' : 'bg-transparent hover:bg-black/[0.03]'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {!isLayoutElement ? (
            <div className="space-y-1.5">
              <div
                className="block w-full"
                style={{
                  ...getLabelStyle(),
                  textAlign: fieldStyles.textAlign || 'left',
                }}
              >
                {field.label}
                {field.required ? <span>*</span> : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="text-xs italic text-slate-400">{propertyName}</span>
                {isLeadProperty ? <FormFieldTag tone="teal">Lead property</FormFieldTag> : null}
                {isMetadataProperty ? <FormFieldTag tone="slate">Metadata</FormFieldTag> : null}
                {field.submitHidden ? <FormFieldTag tone="violet">Hidden field</FormFieldTag> : null}
                {excluded ? <FormFieldTag tone="slate">No form CSS</FormFieldTag> : null}
                {field.defaultValue && !field.submitHidden ? (
                  <FormFieldTag tone="slate">Default: {defaultDisplayLabel}</FormFieldTag>
                ) : null}
              </div>
            </div>
          ) : field.type === 'heading' ? (
            <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-sm font-semibold text-slate-900">Heading</span>
              <FormFieldTag tone="slate">{field.headingLevel || 'h2'}</FormFieldTag>
            </div>
          ) : field.type === 'captcha' ? (
            <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="text-sm font-semibold text-slate-900">Captcha</span>
              <FormFieldTag tone="violet">
                {getCaptchaTypeMeta(field.captchaType).name}
              </FormFieldTag>
            </div>
          ) : null}

          <div className={cn(!isLayoutElement && 'mt-2.5')}>{renderFieldControl()}</div>

          {field.submitHidden && field.defaultValue ? (
            <p className="mt-1.5 text-[11px] text-violet-700">
              Submits <span className="font-medium">{defaultDisplayLabel}</span> when the form is posted.
            </p>
          ) : null}
        </div>

        <div
          className={cn(
            'flex shrink-0 flex-col items-center gap-1 pt-0.5 transition-opacity',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600"
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
          {!field.locked || isPhoneWidgetJunkField(field) ? (
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:bg-white hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                onRemove(field.id)
              }}
              title="Remove field"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// Draggable Field Type Component
function DraggableFieldType({ fieldType, onClick, disabled = false }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `field-type-${fieldType.id}`,
    data: {
      type: 'fieldType',
      fieldType,
    },
    disabled,
  })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  const IconComponent = fieldType.icon

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...(disabled ? {} : { ...listeners, ...attributes })}
      onClick={() => {
        if (disabled) return
        onClick?.(fieldType)
      }}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed border-transparent bg-slate-50 text-slate-400'
          : 'cursor-grab border-transparent bg-sky-50/70 text-slate-700 hover:border-sky-200 hover:bg-sky-50 active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
    >
      <GripVertical className={cn('h-3.5 w-3.5 shrink-0', disabled ? 'text-slate-300' : 'text-slate-400')} />
      <IconComponent className={cn('h-4 w-4 shrink-0', disabled ? 'text-slate-300' : 'text-slate-500')} />
      <span className="flex-1 text-left font-medium">{fieldType.name}</span>
    </button>
  )
}

function DraggableLeadProperty({ property, used = false, onAdd }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lead-prop-${property.id}`,
    data: {
      type: 'leadProperty',
      property,
    },
    disabled: used,
  })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  const IconComponent = property.icon || Type

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...(used ? {} : { ...listeners, ...attributes })}
      onClick={() => {
        if (used) return
        onAdd?.(property)
      }}
      disabled={used}
      title={used ? 'Already on this form' : `Add ${property.label}`}
      className={cn(
        'w-full flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors',
        used
          ? 'cursor-not-allowed border-transparent bg-slate-50 text-slate-400'
          : 'cursor-grab border-transparent bg-sky-50/70 text-slate-700 hover:border-sky-200 hover:bg-sky-50 active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
    >
      <GripVertical className={cn('h-3.5 w-3.5 shrink-0', used ? 'text-slate-300' : 'text-slate-400')} />
      <IconComponent className={cn('h-4 w-4 shrink-0', used ? 'text-slate-300' : 'text-slate-500')} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate font-medium">{property.label}</span>
        <span className="block truncate text-[11px] italic text-slate-400">{property.name}</span>
      </span>
    </button>
  )
}

function DraggableFormElement({ element, used = false, onAdd }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `form-el-${element.id}`,
    data: {
      type: 'formElement',
      element,
    },
    disabled: used,
  })

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined

  const IconComponent = element.icon || Type

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...(used ? {} : { ...listeners, ...attributes })}
      onClick={() => {
        if (used) return
        onAdd?.(element)
      }}
      disabled={used}
      title={used ? 'Already on this form' : `Add ${element.name}`}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm transition-colors',
        used
          ? 'cursor-not-allowed border-transparent bg-slate-50 text-slate-400'
          : 'cursor-grab border-transparent bg-sky-50/70 text-slate-700 hover:border-sky-200 hover:bg-sky-50 active:cursor-grabbing',
        isDragging && 'opacity-50'
      )}
    >
      <GripVertical className={cn('h-3.5 w-3.5 shrink-0', used ? 'text-slate-300' : 'text-slate-400')} />
      <IconComponent className={cn('h-4 w-4 shrink-0', used ? 'text-slate-300' : 'text-slate-500')} />
      <span className="flex-1 text-left font-medium">{element.name}</span>
    </button>
  )
}

function DroppableCanvas({ children, isEmpty }) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'form-canvas',
    data: {
      type: 'canvas',
    },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'min-h-[500px] transition-colors',
        isOver && 'bg-sky-50/50 ring-2 ring-inset ring-sky-300'
      )}
    >
      {children}
    </div>
  )
}

function FormsPageInner() {
  const toast = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get('view') || 'templates'
  const user = getCurrentUser()
  const canWriteForms = hasPermission('marketing', 'forms', 'write')
  const canDeleteForms = hasPermission('marketing', 'forms', 'delete')
  const manageDefaults = canManageDefaultWorkflows()
  const superAdmin = isSuperAdmin()

  // Forms list (templates view)
  const [forms, setForms] = useState([])
  const [ownTemplates, setOwnTemplates] = useState([])
  const [orgDefaultTemplates, setOrgDefaultTemplates] = useState([])
  const [globalTemplates, setGlobalTemplates] = useState([])
  const [hasBuckets, setHasBuckets] = useState(false)
  const [formsLoading, setFormsLoading] = useState(false)
  const [formsError, setFormsError] = useState(null)
  const [formsPage, setFormsPage] = useState(1)
  const [formsTotalPages, setFormsTotalPages] = useState(1)
  const [formsTotalCount, setFormsTotalCount] = useState(0)
  const [formsSearch, setFormsSearch] = useState('')
  const [formsSearchDebounced, setFormsSearchDebounced] = useState('')
  const [heartAnimIds, setHeartAnimIds] = useState(new Set())
  const [togglingIds, setTogglingIds] = useState(new Set())
  const [scopeDialogOpen, setScopeDialogOpen] = useState(false)
  const [scopeTarget, setScopeTarget] = useState(null)
  const [scopeMode, setScopeMode] = useState('promote')
  const [scopeBusy, setScopeBusy] = useState(false)

  const FORMS_PAGE_SIZE = 9

  const applyFormBuckets = useCallback((buckets) => {
    setHasBuckets(Boolean(buckets.hasBuckets))
    setOwnTemplates(buckets.ownTemplates || [])
    setOrgDefaultTemplates(buckets.orgDefaultTemplates || [])
    setGlobalTemplates(buckets.globalTemplates || [])
    setForms(buckets.list || [])
  }, [])

  const patchFormInBuckets = useCallback((id, updater) => {
    const match = (f) => String(f?._id || f?.id) === String(id)
    const mapList = (arr) => (arr || []).map((f) => (match(f) ? updater(f) : f))
    setOwnTemplates((prev) => mapList(prev))
    setOrgDefaultTemplates((prev) => mapList(prev))
    setGlobalTemplates((prev) => mapList(prev))
    setForms((prev) => mapList(prev))
  }, [])

  const removeFormFromBuckets = useCallback((id) => {
    const keep = (f) => String(f?._id || f?.id) !== String(id)
    setOwnTemplates((prev) => prev.filter(keep))
    setOrgDefaultTemplates((prev) => prev.filter(keep))
    setGlobalTemplates((prev) => prev.filter(keep))
    setForms((prev) => prev.filter(keep))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => setFormsSearchDebounced(formsSearch), 300)
    return () => clearTimeout(t)
  }, [formsSearch])

  useEffect(() => {
    setFormsPage(1)
  }, [formsSearchDebounced])

  const fetchForms = useCallback(async () => {
    setFormsLoading(true)
    setFormsError(null)
    try {
      const params = new URLSearchParams({ page: String(formsPage), limit: String(FORMS_PAGE_SIZE) })
      if (formsSearchDebounced.trim()) params.set('search', formsSearchDebounced.trim())
      const result = await api.get(`/api/formBuilder?${params.toString()}`)
      if (result.success) {
        const parsed = parseScopedTemplateList(result.data ?? result, 'forms')
        const total = parsed.total ?? parsed.list.length
        const nextTotalPages = Math.max(
          1,
          Number(parsed.totalPages) || Math.ceil(total / FORMS_PAGE_SIZE),
        )
        if (formsPage > nextTotalPages) {
          setFormsPage(nextTotalPages)
          return
        }
        applyFormBuckets(parsed)
        setFormsTotalCount(total)
        setFormsTotalPages(nextTotalPages)
      } else {
        setFormsError(result.error || 'Failed to fetch forms')
      }
    } catch (e) {
      setFormsError('Failed to fetch forms')
    } finally {
      setFormsLoading(false)
    }
  }, [formsPage, formsSearchDebounced, applyFormBuckets])

  useEffect(() => {
    fetchForms()
  }, [fetchForms])

  const toggleFormFavorite = async (form) => {
    if (togglingIds.has(form._id)) return
    setTogglingIds((prev) => new Set(prev).add(form._id))
    setHeartAnimIds((prev) => new Set(prev).add(form._id))
    setTimeout(() => {
      setHeartAnimIds((prev) => {
        const s = new Set(prev)
        s.delete(form._id)
        return s
      })
    }, 400)
    const next = !form.isFavorite
    patchFormInBuckets(form._id, (f) => ({ ...f, isFavorite: next }))
    try {
      const result = await api.put(`/api/formBuilder/${form._id}`, { isFavorite: next })
      if (!result.success) patchFormInBuckets(form._id, (f) => ({ ...f, isFavorite: !next }))
    } catch {
      patchFormInBuckets(form._id, (f) => ({ ...f, isFavorite: !next }))
    } finally {
      setTogglingIds((prev) => {
        const s = new Set(prev)
        s.delete(form._id)
        return s
      })
    }
  }

  const toggleFormStatus = async (form) => {
    if (togglingIds.has(form._id)) return
    setTogglingIds((prev) => new Set(prev).add(form._id))
    const isGlobal = templateScopeVariant(form) === 'global'
    if (isGlobal) {
      const prevActivation = form.studioActivationStatus
      const next = prevActivation === 'active' ? 'inactive' : 'active'
      patchFormInBuckets(form._id, (f) => ({ ...f, studioActivationStatus: next }))
      try {
        const result = await api.patch(`/api/formBuilder/${form._id}/activation`, { status: next })
        if (!result.success) {
          patchFormInBuckets(form._id, (f) => ({ ...f, studioActivationStatus: prevActivation }))
        }
      } catch {
        patchFormInBuckets(form._id, (f) => ({ ...f, studioActivationStatus: prevActivation }))
      } finally {
        setTogglingIds((prev) => {
          const s = new Set(prev)
          s.delete(form._id)
          return s
        })
      }
      return
    }

    const next = form.status === 'active' ? 'inactive' : 'active'
    patchFormInBuckets(form._id, (f) => ({ ...f, status: next }))
    try {
      const result = await api.put(`/api/formBuilder/${form._id}`, { status: next })
      if (!result.success) patchFormInBuckets(form._id, (f) => ({ ...f, status: form.status }))
    } catch {
      patchFormInBuckets(form._id, (f) => ({ ...f, status: form.status }))
    } finally {
      setTogglingIds((prev) => {
        const s = new Set(prev)
        s.delete(form._id)
        return s
      })
    }
  }

  const openScopeDialog = (form, mode = 'promote') => {
    setScopeTarget({
      id: form._id,
      name: form.name || '',
      currentScope: form.templateScope ?? null,
    })
    setScopeMode(mode)
    setScopeDialogOpen(true)
  }

  const confirmFormScope = async (templateScope) => {
    const id = scopeTarget?.id
    if (!id || scopeBusy) return
    setScopeBusy(true)
    try {
      const result = await api.patch(`/api/formBuilder/${id}/scope`, { templateScope })
      if (result.success) {
        setScopeDialogOpen(false)
        setScopeTarget(null)
        const label =
          templateScope === 'global'
            ? 'Global template'
            : templateScope === 'organization_default'
              ? 'Organisation default'
              : 'regular form'
        toast.success({ title: 'Scope updated', message: `Form scope set to ${label}.` })
        await fetchForms()
      } else {
        toast.error({ title: 'Scope update failed', message: result.error || 'Could not update scope.' })
      }
    } catch {
      toast.error({ title: 'Error', message: 'Could not update form scope.' })
    } finally {
      setScopeBusy(false)
    }
  }

  const [gaViews, setGaViews] = useState({ allTime: 0, last30Days: 0, last7Days: 0 })
  const [gaActiveUsers, setGaActiveUsers] = useState({ allTime: 0, last30Days: 0, last7Days: 0 })
  const [gaPages, setGaPages] = useState({ allTime: [], last30Days: [], last7Days: [] })
  const [gaPagesRange, setGaPagesRange] = useState('last30Days')
  const [gaPagesDimension, setGaPagesDimension] = useState('pagePath') // pagePath | pageTitle
  const [gaDemographics, setGaDemographics] = useState({
    countries: { allTime: [], last30Days: [], last7Days: [] },
    regions: { allTime: [], last30Days: [], last7Days: [] },
    cities: { allTime: [], last30Days: [], last7Days: [] },
  })
  const [gaDemographicsRange, setGaDemographicsRange] = useState('last30Days')
  const [gaViewsLoading, setGaViewsLoading] = useState(false)
  const [gaViewsError, setGaViewsError] = useState(null)

  // Templates/forms table (NOT from Google Analytics; from existing backend forms API)
  const [analyticsForms, setAnalyticsForms] = useState([])
  const [analyticsFormsLoading, setAnalyticsFormsLoading] = useState(false)
  const [analyticsFormsError, setAnalyticsFormsError] = useState(null)

  // Theme-aligned palette (brand + semantic accents via CSS vars)
  const COUNTRY_COLORS = [
    'var(--studio-primary)',
    'var(--studio-gradient)',
    'var(--side-gradient-end)',
    'var(--side-gradient-start)',
    'hsl(var(--destructive))',
    'hsl(var(--foreground) / 0.85)',
    'hsl(var(--foreground) / 0.65)',
    'hsl(var(--foreground) / 0.45)',
  ]

  const formatDuration = (seconds) => {
    const s = Number(seconds)
    if (!Number.isFinite(s) || s <= 0) return '0s'
    const total = Math.round(s)
    const m = Math.floor(total / 60)
    const r = total % 60
    return m > 0 ? `${m}m ${r}s` : `${r}s`
  }

  const makePieSegments = (items) => {
    const total = items.reduce((sum, it) => sum + (Number(it?.value) || 0), 0)
    if (!total) return { total: 0, segments: [] }
    let start = 0
    const segments = items.map((it, idx) => {
      const v = Number(it?.value) || 0
      const frac = v / total
      const seg = { ...it, startFrac: start, endFrac: start + frac, color: COUNTRY_COLORS[idx % COUNTRY_COLORS.length] }
      start += frac
      return seg
    })
    return { total, segments }
  }

  const segmentLabelPosition = (cx, cy, r, startFrac, endFrac) => {
    const mid = (startFrac + endFrac) / 2
    const angle = mid * Math.PI * 2 - Math.PI / 2
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  }

  const describeArc = (cx, cy, r, startFrac, endFrac) => {
    const startAngle = startFrac * Math.PI * 2 - Math.PI / 2
    const endAngle = endFrac * Math.PI * 2 - Math.PI / 2
    const x1 = cx + r * Math.cos(startAngle)
    const y1 = cy + r * Math.sin(startAngle)
    const x2 = cx + r * Math.cos(endAngle)
    const y2 = cy + r * Math.sin(endAngle)
    const largeArc = endFrac - startFrac > 0.5 ? 1 : 0
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
  }

  const fetchGaViews = useCallback(async () => {
    setGaViewsLoading(true)
    setGaViewsError(null)
    try {
      const res = await fetch(`/api/ga/forms-views?pagesDimension=${encodeURIComponent(gaPagesDimension)}`)
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.success) {
        setGaViewsError(body?.error || 'Failed to load Google Analytics views')
        return
      }
      setGaViews({
        allTime: Number(body.data?.views?.allTime) || 0,
        last30Days: Number(body.data?.views?.last30Days) || 0,
        last7Days: Number(body.data?.views?.last7Days) || 0,
      })
      setGaActiveUsers({
        allTime: Number(body.data?.activeUsers?.allTime) || 0,
        last30Days: Number(body.data?.activeUsers?.last30Days) || 0,
        last7Days: Number(body.data?.activeUsers?.last7Days) || 0,
      })
      setGaPages({
        allTime: Array.isArray(body.data?.pages?.allTime) ? body.data.pages.allTime : [],
        last30Days: Array.isArray(body.data?.pages?.last30Days) ? body.data.pages.last30Days : [],
        last7Days: Array.isArray(body.data?.pages?.last7Days) ? body.data.pages.last7Days : [],
      })
      const demo = body.data?.demographics || {}
      setGaDemographics({
        countries: {
          allTime: Array.isArray(demo?.countries?.allTime) ? demo.countries.allTime : [],
          last30Days: Array.isArray(demo?.countries?.last30Days) ? demo.countries.last30Days : [],
          last7Days: Array.isArray(demo?.countries?.last7Days) ? demo.countries.last7Days : [],
        },
        regions: {
          allTime: Array.isArray(demo?.regions?.allTime) ? demo.regions.allTime : [],
          last30Days: Array.isArray(demo?.regions?.last30Days) ? demo.regions.last30Days : [],
          last7Days: Array.isArray(demo?.regions?.last7Days) ? demo.regions.last7Days : [],
        },
        cities: {
          allTime: Array.isArray(demo?.cities?.allTime) ? demo.cities.allTime : [],
          last30Days: Array.isArray(demo?.cities?.last30Days) ? demo.cities.last30Days : [],
          last7Days: Array.isArray(demo?.cities?.last7Days) ? demo.cities.last7Days : [],
        },
      })
    } catch (e) {
      setGaViewsError('Failed to load Google Analytics views')
    } finally {
      setGaViewsLoading(false)
    }
  }, [gaPagesDimension])

  const fetchAnalyticsForms = useCallback(async () => {
    setAnalyticsFormsLoading(true)
    setAnalyticsFormsError(null)
    try {
      // Use backend forms API for templates table:
      // http://localhost:8080/api/formBuilder?page=1&limit=9
      const params = new URLSearchParams({ page: '1', limit: '9' })
      const result = await api.get(`/api/formBuilder?${params.toString()}`)
      const list = Array.isArray(result.data) ? result.data : null
      if (result.success && list) {
        setAnalyticsForms(list)
      } else {
        setAnalyticsFormsError(result.error || 'Failed to load forms for analytics')
      }
    } catch {
      setAnalyticsFormsError('Failed to load forms for analytics')
    } finally {
      setAnalyticsFormsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchGaViews()
      fetchAnalyticsForms()
    }
  }, [activeTab, fetchGaViews, fetchAnalyticsForms])

  const extractViewTimestamps = (form) => {
    const candidates = [
      form?.views,
      form?.viewEvents,
      form?.analytics?.views,
      form?.analytics?.viewEvents,
    ]
    for (const c of candidates) {
      if (!c) continue
      if (Array.isArray(c)) return c
    }
    return []
  }

  const viewsSummary = (() => {
    const now = Date.now()
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000
    const monthAgo = now - 30 * 24 * 60 * 60 * 1000

    let all = 0
    let lastWeek = 0
    let lastMonth = 0

    for (const f of forms) {
      const tsList = extractViewTimestamps(f)
      for (const t of tsList) {
        const ms = typeof t === 'number' ? t : Date.parse(String(t))
        if (!Number.isFinite(ms)) continue
        all += 1
        if (ms >= monthAgo) lastMonth += 1
        if (ms >= weekAgo) lastWeek += 1
      }
    }

    return { all, lastMonth, lastWeek }
  })()

  // Builder form metadata
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formLocationID, setFormLocationID] = useState(() => {
    const branch = getEffectiveBranch()
    return branch ? [String(branch)] : []
  }) // 'all' | string[]

  const [editingFormId, setEditingFormId] = useState(null)
  const [savingForm, setSavingForm] = useState(false)
  // Delete
  const [deletingFormId, setDeletingFormId] = useState(null)
  // Preview modal
  const [previewForm, setPreviewForm] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  // Clone
  const [cloningFormId, setCloningFormId] = useState(null)
  const [leadReasons, setLeadReasons] = useState([])
  const [locations, setLocations] = useState([])
  // Snapshot of reason options at open/save — used by StylePanel "Reset"
  const [reasonOptionsBaseline, setReasonOptionsBaseline] = useState([])

  // Backend-required hidden fields injected into exported HTML
  const organisationID = user?.organisationID || ''
  const formID = editingFormId || ''
  const REQUIRED_FIELD_NAMES = new Set([
    'organisationID',
    'formID',
    'locationID',
    'name',
    'email',
    'phoneNumber',
    'reason',
  ])

  const [builderFormType, setBuilderFormType] = useState('lead')
  const [pendingFormType, setPendingFormType] = useState('lead')
  const [propertySearch, setPropertySearch] = useState('')
  const [showCustomFieldTypes, setShowCustomFieldTypes] = useState(false)
  const [showCaptchaTypes, setShowCaptchaTypes] = useState(false)

  const [formFields, setFormFields] = useState(() => buildInitialFormFields('lead', [], []))
  const [selectedField, setSelectedField] = useState(null)
  const [activeId, setActiveId] = useState(null)
  const [showPreview, setShowPreview] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportedHTML, setExportedHTML] = useState('')
  const [embedCode, setEmbedCode] = useState('')
  const [shareLink, setShareLink] = useState('')
  const [exportTab, setExportTab] = useState('embed') // 'embed' | 'share' | 'html'
  const [submitButton, setSubmitButton] = useState({
    id: 'submit-button',
    type: 'submit',
    label: 'Submit Form',
    styles: {},
  })
  const [redirectUrl, setRedirectUrl] = useState('')
  const [globalStyles, setGlobalStyles] = useState({})
  const [globalStyleExcludeKeys, setGlobalStyleExcludeKeys] = useState([])
  const [settingsPanelMode, setSettingsPanelMode] = useState('field') // 'field' | 'global'

  const setActiveTab = (tab) => {
    const params = new URLSearchParams(searchParams?.toString() || '')
    params.set('view', tab)
    router.push(`${pathname}?${params.toString()}`)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const locationID = resolveReasonsLocationID(formLocationID)
        const [reasonsResult, locationsResult] = await Promise.all([
          api.get(leadReasonsUrl(locationID)),
          api.get('/api/location?limit=200'),
        ])
        if (cancelled) return
        if (reasonsResult.success) {
          setLeadReasons(extractLeadReasonsList(reasonsResult))
        }
        if (locationsResult.success) {
          const locs = (locationsResult.data || []).filter(
            (loc) => loc.status?.toLowerCase() === 'active' || !loc.status
          )
          setLocations(locs)
        }
      } catch (e) {
        console.error(e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [formLocationID])

  const refreshLeadReasons = useCallback(async () => {
    try {
      const locationID = resolveReasonsLocationID(formLocationID)
      const result = await api.get(leadReasonsUrl(locationID))
      if (!result.success) return
      setLeadReasons(extractLeadReasonsList(result))
    } catch (e) {
      console.error(e)
    }
  }, [formLocationID])

  // When the navbar branch changes under All branches, reload location-scoped reasons.
  useEffect(() => {
    const onBranchChange = () => {
      refreshLeadReasons()
    }
    window.addEventListener('branch-change', onBranchChange)
    return () => window.removeEventListener('branch-change', onBranchChange)
  }, [refreshLeadReasons])

  useEffect(() => {
    const reasonsLocationID = resolveReasonsLocationID(formLocationID)
    const reasonOptions = buildReasonOptions(leadReasons)
    const studioOptions = buildStudioOptionsForForm(locations, formLocationID)
    const optsKey = (opts) =>
      JSON.stringify((opts || []).map((o) => [o.value, o.label]))

    setFormFields((prev) => {
      let changed = false
      let next = prev.map((f) => {
        if (f.name === 'reason') {
          const existing = Array.isArray(f.options) ? f.options : []
          // Only reseed when the studio actually changed. Missing stamp (import /
          // first paint) must keep curated options — otherwise reopen wipes order.
          const locationChanged =
            f.reasonsLocationID != null &&
            f.reasonsLocationID !== '' &&
            String(f.reasonsLocationID) !== String(reasonsLocationID || '')

          if (existing.length > 0 && !locationChanged) {
            const refreshed = sanitizeReasonOptions(existing).map((opt) => ({
              value: opt.value,
              label: formatReasonLabel(opt.value || opt.label, leadReasons),
            }))
            if (
              f.type === 'select' &&
              f.optionsLocked === false &&
              String(f.reasonsLocationID || '') === String(reasonsLocationID || '') &&
              optsKey(f.options) === optsKey(refreshed)
            ) {
              return f
            }
            changed = true
            return {
              ...f,
              type: 'select',
              propertyKind: f.propertyKind || 'lead',
              optionsLocked: false,
              reasonsLocationID,
              placeholder: f.placeholder?.trim() ? f.placeholder : 'Select Reason',
              options: refreshed,
            }
          }

          if (!reasonOptions.length && !locationChanged) return f

          changed = true
          return {
            ...f,
            type: 'select',
            propertyKind: f.propertyKind || 'lead',
            optionsLocked: false,
            reasonsLocationID,
            placeholder: f.placeholder?.trim() ? f.placeholder : 'Select Reason',
            options: reasonOptions,
          }
        }
        if (f.name === 'locationID') {
          const nextLabel = f.label === 'locationID' ? 'Studio' : f.label || 'Studio'
          const scopeIds = resolveFormStudioScopeIds(formLocationID)
          const branch = getEffectiveBranch()
          // Prefer the single scoped studio, else navbar branch, when seeding.
          const preferredDefault =
            scopeIds.length === 1
              ? scopeIds[0]
              : branch && studioOptions.some((o) => String(o.value) === String(branch))
                ? String(branch)
                : studioOptions.length === 1
                  ? String(studioOptions[0].value)
                  : null

          let nextDefault = f.defaultValue
          let seeded = Boolean(f.studioDefaultSeeded)

          // Always keep default on the only available studio when scope is a single branch.
          if (scopeIds.length === 1 && preferredDefault) {
            nextDefault = preferredDefault
            seeded = true
          } else if (
            !seeded &&
            (nextDefault == null || String(nextDefault).trim() === '') &&
            preferredDefault
          ) {
            nextDefault = preferredDefault
            seeded = true
          } else if (nextDefault != null && String(nextDefault).trim() !== '') {
            // Drop defaults that are no longer in the scoped options.
            if (
              studioOptions.length &&
              !studioOptions.some((o) => String(o.value) === String(nextDefault))
            ) {
              nextDefault = preferredDefault || undefined
            }
            seeded = true
          }

          if (
            f.type === 'select' &&
            f.optionsLocked &&
            f.label === nextLabel &&
            optsKey(f.options) === optsKey(studioOptions) &&
            String(f.defaultValue || '') === String(nextDefault || '') &&
            Boolean(f.studioDefaultSeeded) === seeded
          ) {
            return f
          }
          changed = true
          return {
            ...f,
            type: 'select',
            name: 'locationID',
            label: nextLabel,
            propertyKind: f.propertyKind || 'lead',
            optionsLocked: true,
            hidden: false,
            options: studioOptions,
            defaultValue: nextDefault,
            studioDefaultSeeded: seeded,
          }
        }
        if (f.name === 'utm_source') {
          const nextLabel = f.label === 'utm_source' ? 'Source' : f.label || 'Source'
          if (
            f.type === 'select' &&
            f.optionsLocked &&
            f.label === nextLabel &&
            optsKey(f.options) === optsKey(UTM_SOURCE_FIELD_OPTIONS)
          ) {
            return f
          }
          changed = true
          return {
            ...f,
            type: 'select',
            label: nextLabel,
            propertyKind: f.propertyKind || 'lead',
            optionsLocked: true,
            options: UTM_SOURCE_FIELD_OPTIONS,
          }
        }
        return f
      })

      if (builderFormType === 'lead') {
        const hasStudio = next.some((f) => f.name === 'locationID')
        if (!hasStudio) {
          const studioProp = LEAD_PROPERTIES.find((p) => p.name === 'locationID')
          const studioField = createLeadPropertyField(studioProp, {
            locations,
            locked: true,
            required: true,
          })
          studioField.id = 'req-studio'
          const phoneIdx = next.findIndex((f) => f.name === 'phoneNumber')
          next = [...next]
          next.splice(phoneIdx >= 0 ? phoneIdx + 1 : next.length, 0, studioField)
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [leadReasons, locations, builderFormType, formLocationID])

  // Always strip phone-widget helper fields from builder state
  useEffect(() => {
    setFormFields((prev) => {
      if (!prev.some(isPhoneWidgetJunkField)) return prev
      return sanitizeFormFields(prev)
    })
  }, [formFields])

  const saveForm = async () => {
    if (!formName.trim()) {
      toast.error({ title: 'Name required', message: 'Please enter a form name before saving.' })
      return
    }

    let locationValue = formLocationID
    const locationMissing =
      !locationValue ||
      (locationValue !== ALL_BRANCHES_VALUE &&
        (!Array.isArray(locationValue) || locationValue.length === 0))

    if (locationMissing) {
      const studioField = formFields.find((f) => f?.name === 'locationID')
      const studioDefault = studioField?.defaultValue
      if (studioDefault != null && String(studioDefault).trim() !== '') {
        locationValue = [String(studioDefault)]
        setFormLocationID(locationValue)
      }
    }

    const stillMissing =
      !locationValue ||
      (locationValue !== ALL_BRANCHES_VALUE &&
        (!Array.isArray(locationValue) || locationValue.length === 0))

    if (stillMissing) {
      toast.error({
        title: 'Location required',
        message:
          'Select one or more studios in the top bar (or All branches) before saving.',
      })
      document.getElementById('form-builder-location')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      return
    }

    if (formFields.filter((f) => !isPhoneWidgetJunkField(f)).length === 0) {
      toast.error({ title: 'Empty form', message: 'Please add at least one field before saving.' })
      return
    }

    // Drop any leaked phone helper fields before save
    const fieldsToSave = sanitizeFormFields(formFields)
    if (fieldsToSave.length !== formFields.length) {
      setFormFields(fieldsToSave)
    }

    setSavingForm(true)
    try {
      const htmlCode = generateExportedHTML()
      if (!htmlCode || !String(htmlCode).trim()) {
        toast.error({ title: 'Export failed', message: 'Could not generate form HTML to save.' })
        return
      }

      const allLocations = locationValue === ALL_BRANCHES_VALUE
      const payload = {
        name: formName.trim(),
        description: formDescription.trim(),
        htmlCode,
        allLocations,
        locationID: allLocations ? [] : locationValue.map(String),
      }

      const result = editingFormId
        ? await api.put(`/api/formBuilder/${editingFormId}`, payload)
        : await api.post('/api/formBuilder', payload)

      if (result.success) {
        const savedId = result.data?._id || editingFormId
        if (savedId) setEditingFormId(savedId)
        // Keep header location in sync with what the API accepted
        if (result.data?.allLocations) {
          setFormLocationID(ALL_BRANCHES_VALUE)
        } else if (Array.isArray(result.data?.locationID) && result.data.locationID.length) {
          setFormLocationID(
            result.data.locationID.map((l) => String(l?._id || l)).filter(Boolean)
          )
        }
        toast.success({
          title: editingFormId ? 'Updated' : 'Saved',
          message: editingFormId ? 'Form updated successfully.' : 'Form created successfully.',
        })
        setReasonOptionsBaseline(getReasonOptionsFromFields(fieldsToSave))
        fetchForms()
        // Stay in the builder after update so edits are not lost from a bad re-import
        if (!editingFormId && savedId) {
          setEditingFormId(savedId)
        }
      } else {
        toast.error({
          title: editingFormId ? 'Update failed' : 'Save failed',
          message: result.error || result.message || 'Could not save form.',
        })
      }
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: e?.message || 'Could not save form.' })
    } finally {
      setSavingForm(false)
    }
  }

  const deleteForm = async (form) => {
    if (!confirm(`Delete "${form.name}"? This cannot be undone.`)) return
    setDeletingFormId(form._id)
    try {
      const result = await api.delete(`/api/formBuilder/${form._id}`)
      if (result.success) {
        toast.success({ title: 'Deleted', message: 'Form deleted successfully.' })
        removeFormFromBuckets(form._id)
        setFormsTotalCount((c) => c - 1)
      } else {
        toast.error({ title: 'Delete failed', message: result.error || 'Could not delete form.' })
      }
    } catch (e) {
      toast.error({ title: 'Error', message: 'Could not delete form.' })
    } finally {
      setDeletingFormId(null)
    }
  }

  const openPreviewForm = async (form) => {
    setPreviewForm({ name: form.name, htmlCode: form.htmlCode || '' })
    if (!form.htmlCode) {
      setPreviewLoading(true)
      try {
        const result = await api.get(`/api/formBuilder/${form._id}`)
        if (result.success) setPreviewForm({ name: result.data.name, htmlCode: result.data.htmlCode || '' })
      } catch (e) {}
      finally { setPreviewLoading(false) }
    }
  }

  const cloneForm = async (form) => {
    if (cloningFormId) return
    setCloningFormId(form._id)
    try {
      const result = await api.get(`/api/formBuilder/${form._id}`)
      if (!result.success) { toast.error({ title: 'Error', message: 'Could not fetch form.' }); return }
      const src = result.data
      const cloneResult = await api.post('/api/formBuilder', {
        name: `${src.name} copy`,
        description: src.description,
        htmlCode: src.htmlCode,
        url: src.url,
        utms: src.utms,
        locationID: src.allLocations
          ? []
          : (Array.isArray(src.locationID)
            ? src.locationID.map((l) => l?._id || l).filter(Boolean)
            : src.locationID?._id || src.locationID
              ? [src.locationID?._id || src.locationID]
              : formLocationID === ALL_BRANCHES_VALUE ? [] : formLocationID),
        allLocations: Boolean(src.allLocations) || formLocationID === ALL_BRANCHES_VALUE,
      })
      if (cloneResult.success) {
        toast.success({ title: 'Cloned', message: `"${src.name} copy" created.` })
        fetchForms()
      } else {
        toast.error({ title: 'Clone failed', message: cloneResult.error || 'Could not clone form.' })
      }
    } catch (e) {
      toast.error({ title: 'Error', message: 'Could not clone form.' })
    } finally {
      setCloningFormId(null)
    }
  }

  const openFormTypePicker = () => {
    setPendingFormType('lead')
    setActiveTab('select-type')
  }

  const startBuilderWithType = (formType) => {
    const type = formType === 'blank' ? 'blank' : 'lead'
    setBuilderFormType(type)
    setFormName('')
    setFormDescription('')
    const branch = getEffectiveBranch()
    setFormLocationID(branch ? [String(branch)] : [])
    setEditingFormId(null)
    const fields = buildInitialFormFields(type, leadReasons, locations)
    setFormFields(fields)
    setReasonOptionsBaseline(getReasonOptionsFromFields(fields))
    setSelectedField(null)
    setSubmitButton({
      id: 'submit-button',
      type: 'submit',
      label: 'Submit Form',
      styles: {},
    })
    setRedirectUrl('')
    setGlobalStyles({})
    setGlobalStyleExcludeKeys([])
    setSettingsPanelMode('field')
    setActiveTab('builder')
  }

  const openBuilderForNew = () => {
    openFormTypePicker()
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const RESERVED_FIELD_NAMES = new Set([
    'organisationID',
    'formID',
    'name',
    'email',
    'phoneNumber',
    'locationID',
    'reason',
    'location',
    'utm_source',
    'metadata',
  ])
  const SYSTEM_HIDDEN_FIELD_NAMES = new Set(['organisationID', 'formID'])

  const getFieldNameForHtml = (field) => {
    if (field?.type === 'heading') return `heading_${field.id}`
    if (field?.type === 'captcha') return 'captcha'
    if (field?.propertyKind === 'metadata' || field?.metadataKey) {
      const key = String(field.metadataKey || 'custom')
        .replace(/[^\w.-]/g, '_')
        .replace(/^_+|_+$/g, '') || 'custom'
      return `metadata[${key}]`
    }
    if (field?.name && !String(field.name).startsWith('metadata.')) return field.name
    if (field?.name?.startsWith('metadata.')) {
      const key = field.name.slice('metadata.'.length)
      return `metadata[${key}]`
    }
    return (field?.label || field?.id || 'field').toLowerCase().replace(/\s+/g, '_')
  }

  const parseCssSize = (value) => {
    const v = String(value || '').trim()
    return v || undefined
  }

  const applyPaddingShorthand = (styles, padding) => {
    const p = String(padding || '').trim()
    if (!p) return
    const parts = p.split(/\s+/).filter(Boolean)
    if (parts.length === 1) {
      styles.paddingTop = parts[0]
      styles.paddingRight = parts[0]
      styles.paddingBottom = parts[0]
      styles.paddingLeft = parts[0]
    } else if (parts.length === 2) {
      styles.paddingTop = parts[0]
      styles.paddingRight = parts[1]
      styles.paddingBottom = parts[0]
      styles.paddingLeft = parts[1]
    } else if (parts.length === 3) {
      styles.paddingTop = parts[0]
      styles.paddingRight = parts[1]
      styles.paddingBottom = parts[2]
      styles.paddingLeft = parts[1]
    } else if (parts.length >= 4) {
      styles.paddingTop = parts[0]
      styles.paddingRight = parts[1]
      styles.paddingBottom = parts[2]
      styles.paddingLeft = parts[3]
    }
  }

  const fieldTypeFromInputType = (t) => {
    const type = String(t || '').toLowerCase()
    if (type === 'email') return 'email'
    if (type === 'tel') return 'phone'
    if (type === 'phone') return 'phone'
    if (type === 'date') return 'date'
    if (type === 'file') return 'file'
    if (type === 'checkbox') return 'checkbox'
    if (type === 'radio') return 'rating'
    return 'text'
  }

  const buildFieldFromControl = (control, idSeed) => {
    const tag = control.tagName.toLowerCase()
    const isTextarea = tag === 'textarea'
    const isSelect = tag === 'select'
    const isInput = tag === 'input'

    let type = 'text'
    if (isTextarea) type = 'textarea'
    else if (isSelect) type = 'select'
    else if (isInput) type = fieldTypeFromInputType(control.getAttribute('type') || 'text')

    // Prefer label in the same container
    const container = control.closest('div') || control.parentElement
    const labelEl = container?.querySelector?.('label')
    const labelText = (labelEl?.textContent || '').replace(/\*/g, '').trim()

    const nameAttr = (control.getAttribute('name') || '').trim()
    const placeholder = (control.getAttribute('placeholder') || '').trim()
    const required = control.hasAttribute('required')

    const styles = {}
    // Input styling from inline styles in exported HTML
    const cs = control.style
    if (cs?.backgroundColor) styles.backgroundColor = cs.backgroundColor
    if (cs?.borderWidth) styles.borderWidth = cs.borderWidth
    if (cs?.borderStyle) styles.borderStyle = cs.borderStyle
    if (cs?.borderColor) styles.borderColor = cs.borderColor
    if (cs?.borderRadius) styles.borderRadius = cs.borderRadius
    if (cs?.width) styles.width = cs.width
    if (cs?.margin) styles.marginTop = cs.margin // preserve shorthand at least
    if (cs?.padding) applyPaddingShorthand(styles, cs.padding)
    if (cs?.paddingTop) styles.paddingTop = cs.paddingTop
    if (cs?.paddingRight) styles.paddingRight = cs.paddingRight
    if (cs?.paddingBottom) styles.paddingBottom = cs.paddingBottom
    if (cs?.paddingLeft) styles.paddingLeft = cs.paddingLeft

    // Label typography
    const ls = labelEl?.style
    if (ls?.fontFamily) styles.fontFamily = ls.fontFamily
    if (ls?.fontSize) styles.fontSize = parseCssSize(ls.fontSize)
    if (ls?.fontWeight) styles.fontWeight = ls.fontWeight
    if (ls?.color) styles.color = ls.color
    if (ls?.letterSpacing) styles.letterSpacing = ls.letterSpacing
    if (ls?.textTransform) styles.textTransform = ls.textTransform
    if (ls?.textAlign) styles.textAlign = ls.textAlign

    const options = []
    if (type === 'select') {
      control.querySelectorAll('option').forEach((opt) => {
        // Keep empty-value prompt options out of field.options (e.g. "Select Reason").
        if (opt.hasAttribute('value') && String(opt.getAttribute('value') || '').trim() === '') {
          return
        }
        const label = (opt.textContent || '').trim()
        const value = String(
          opt.hasAttribute('value') ? opt.getAttribute('value') ?? '' : label || ''
        ).trim()
        if (!value || isSelectPlaceholderOption({ value, label })) return
        options.push({ label: label || value, value })
      })
    }

    const defaultValue =
      control.getAttribute('value') ||
      (type === 'select'
        ? control.querySelector('option[selected]')?.getAttribute('value') ||
          control.querySelector('option[selected]')?.textContent?.trim()
        : '') ||
      ''

    return {
      id: `import-${idSeed}-${Date.now()}`,
      type,
      label: labelText || (nameAttr ? nameAttr.replace(/[_-]+/g, ' ') : 'Field'),
      name: nameAttr ? nameAttr.replace(/\[\]$/, '') : undefined,
      placeholder,
      required,
      defaultValue: defaultValue || undefined,
      styles,
      options,
    }
  }

  const importFormIntoBuilder = async (form) => {
    try {
      setSavingForm(false)
      setSelectedField(null)
      setSettingsPanelMode('field')

      // Always load the full form so location + htmlCode are complete for updates
      let full = form
      if (form?._id) {
        const result = await api.get(`/api/formBuilder/${form._id}`)
        if (result.success && result.data) {
          full = result.data
        } else if (!form?.htmlCode) {
          toast.error({
            title: 'Load failed',
            message: result.error || 'Could not load this form for editing.',
          })
          return
        }
      }

      const htmlCode = full?.htmlCode || ''

      setEditingFormId(full?._id || form?._id || null)
      setFormName(full?.name || form?.name || '')
      setFormDescription(full?.description || form?.description || '')

      const locIds = full?.allLocations
        ? ALL_BRANCHES_VALUE
        : Array.isArray(full?.locationID)
          ? full.locationID.map((l) => String(l?._id || l)).filter(Boolean)
          : full?.locationID?._id || full?.locationID
            ? [String(full.locationID?._id || full.locationID)]
            : []
      setFormLocationID(locIds)

      const inferred = []
      const byName = new Map()
      setRedirectUrl('')

      if (htmlCode && typeof window !== 'undefined') {
        const doc = new DOMParser().parseFromString(htmlCode, 'text/html')
        const formEl = doc.querySelector('form')

        const redirectMeta =
          doc.querySelector('meta[name="cadance-redirect-url"]')?.getAttribute('content') || ''
        setRedirectUrl(normalizeStandaloneRedirectUrl(redirectMeta))

        const submitEl = formEl?.querySelector('button[type="submit"], input[type="submit"]')
        const submitLabel = submitEl
          ? submitEl.tagName.toLowerCase() === 'input'
            ? submitEl.getAttribute('value')
            : submitEl.textContent
          : ''
        if (submitLabel && submitLabel.trim()) {
          setSubmitButton((prev) => ({
            ...prev,
            label: submitLabel.trim(),
            styles: prev.styles || {},
          }))
        }

        // Restore headings (not present as inputs)
        const headingEls = formEl
          ? Array.from(formEl.querySelectorAll('h1, h2, h3, h4'))
          : []
        headingEls.forEach((el, idx) => {
          const tag = el.tagName.toLowerCase()
          const box = el.parentElement?.style || {}
          const text = el.style || {}
          const styles = {}
          const bg = box.background || box.backgroundColor || text.backgroundColor
          if (bg) styles.backgroundColor = bg
          if (text.fontSize || box.fontSize) styles.fontSize = parseCssSize(text.fontSize || box.fontSize)
          if (text.fontWeight || box.fontWeight) styles.fontWeight = text.fontWeight || box.fontWeight
          if (text.color || box.color) styles.color = text.color || box.color
          if (text.fontFamily || box.fontFamily) styles.fontFamily = text.fontFamily || box.fontFamily
          if (text.textAlign || box.textAlign) {
            styles.textAlign = text.textAlign || box.textAlign
            styles.blockAlign = text.textAlign || box.textAlign
          }
          if (box.paddingTop) styles.paddingTop = box.paddingTop
          if (box.paddingRight) styles.paddingRight = box.paddingRight
          if (box.paddingBottom) styles.paddingBottom = box.paddingBottom
          if (box.paddingLeft) styles.paddingLeft = box.paddingLeft
          if (box.borderRadius) styles.borderRadius = box.borderRadius
          if (box.width) styles.width = box.width
          inferred.push({
            id: `import-heading-${idx}-${Date.now()}`,
            type: 'heading',
            headingLevel: tag,
            label: (el.textContent || 'Heading').trim(),
            propertyKind: 'layout',
            required: false,
            styles,
          })
        })

        // Restore captcha block if present
        const captchaEl = formEl?.querySelector('[data-crm-captcha], .crm-captcha, [data-captcha-type]')
        if (captchaEl) {
          const captchaType =
            captchaEl.getAttribute('data-captcha-type') ||
            captchaEl.getAttribute('data-crm-captcha') ||
            'robot'
          inferred.push(createCaptchaField(captchaType))
        }

        // Restore phone widgets as a single phone field (ignore helper inputs)
        const PHONE_HELPER_NAMES = new Set(['phoneLocal', 'phoneCountryCode'])
        const phoneWidgets = formEl
          ? Array.from(formEl.querySelectorAll('[data-phone-field="1"], .crm-phone-field'))
          : []
        phoneWidgets.forEach((wrap, idx) => {
          const e164 = wrap.querySelector('.crm-phone-e164, [data-crm-phone-e164]')
          const nameAttr = (e164?.getAttribute('name') || 'phoneNumber').trim()
          const labelEl = wrap.querySelector('.crm-phone-label')
          const labelText = (labelEl?.textContent || 'Phone number').replace(/\*/g, '').trim()
          const defaultCode = wrap.getAttribute('data-default-code') || '+1'
          const defaultIso = wrap.getAttribute('data-default-iso') || 'US'
          const local = wrap.querySelector('.crm-phone-local')
          const required = local?.hasAttribute('required') || e164?.hasAttribute('required')
          inferred.push({
            id: `import-phone-${idx}-${Date.now()}`,
            type: 'phone',
            name: nameAttr,
            label: labelText || 'Phone number',
            placeholder: local?.getAttribute('placeholder') || '',
            required: Boolean(required),
            defaultCountryCode: defaultCode,
            defaultCountryIso: defaultIso,
            propertyKind: LEAD_PROPERTY_NAMES.has(nameAttr) ? 'lead' : 'custom',
            styles: {},
          })
        })

        const controls = formEl ? Array.from(formEl.querySelectorAll('input, textarea, select')) : []
        controls.forEach((control, idx) => {
          const tag = control.tagName.toLowerCase()
          const typeAttr = tag === 'input' ? (control.getAttribute('type') || '').toLowerCase() : ''
          const nameAttr = (control.getAttribute('name') || '').trim().replace(/\[\]$/, '')

          if (typeAttr === 'submit') return
          // Skip phone widget internals (local/cc/search/e164 — e164 handled above)
          if (
            control.closest('[data-phone-field="1"], .crm-phone-field') ||
            control.classList?.contains('crm-phone-local') ||
            control.classList?.contains('crm-phone-cc') ||
            control.classList?.contains('crm-phone-search') ||
            control.classList?.contains('crm-phone-e164') ||
            control.hasAttribute('data-crm-phone-local') ||
            control.hasAttribute('data-crm-phone-cc') ||
            control.hasAttribute('data-crm-phone-search') ||
            control.hasAttribute('data-crm-phone-e164')
          ) {
            return
          }
          if (PHONE_HELPER_NAMES.has(nameAttr)) return
          // Skip nameless helper inputs (e.g. old country search)
          if (!nameAttr) return

          if (typeAttr === 'hidden') {
            if (SYSTEM_HIDDEN_FIELD_NAMES.has(nameAttr)) return
            if (PHONE_HELPER_NAMES.has(nameAttr)) return
            inferred.push({
              id: `import-hidden-${idx}-${Date.now()}`,
              type: nameAttr === 'locationID' || nameAttr === 'reason' || nameAttr === 'utm_source' ? 'select' : 'text',
              label: nameAttr.replace(/[_-]+/g, ' '),
              name: nameAttr,
              defaultValue: control.getAttribute('value') || '',
              submitHidden: true,
              required: false,
              styles: {},
              propertyKind: LEAD_PROPERTY_NAMES.has(nameAttr) ? 'lead' : undefined,
            })
            return
          }
          if (SYSTEM_HIDDEN_FIELD_NAMES.has(nameAttr)) return

          if (tag === 'input' && typeAttr === 'checkbox' && nameAttr) {
            const existing = byName.get(nameAttr)
            if (existing) {
              const labelEl = control.closest('div')?.querySelector('label')
              const optLabel = (
                labelEl?.textContent ||
                control.getAttribute('value') ||
                `Option ${existing.options.length + 1}`
              ).trim()
              const optValue = (control.getAttribute('value') || optLabel).trim()
              existing.options.push({ label: optLabel, value: optValue })
              return
            }
          }

          const field = buildFieldFromControl(control, idx)
          if (field?.name) {
            if (byName.has(field.name)) return
            byName.set(field.name, field)
            if (LEAD_PROPERTY_NAMES.has(field.name)) field.propertyKind = 'lead'
            if (String(field.name).startsWith('metadata.') || String(nameAttr).startsWith('metadata[')) {
              field.propertyKind = 'metadata'
              const metaMatch = String(nameAttr).match(/^metadata\[([^\]]+)\]$/)
              if (metaMatch) {
                field.metadataKey = metaMatch[1]
                field.name = `metadata.${metaMatch[1]}`
              }
            }
            // Ensure phoneNumber comes back as phone type
            if (field.name === 'phoneNumber' || field.type === 'phone') {
              field.type = 'phone'
            }
          }
          inferred.push(field)
        })
      }

      const detectedType = detectFormTypeFromInferred(inferred)
      setBuilderFormType(detectedType)

      const baseFields =
        detectedType === 'lead'
          ? buildInitialFormFields('lead', leadReasons, locations)
          : [...REQUIRED_SYSTEM_FIELDS]

      // Merge imported core fields into base (preserve defaults, hidden, styles, labels)
      const inferredByName = new Map()
      inferred.forEach((f) => {
        if (f?.name) inferredByName.set(f.name, f)
      })

      const importReasonsLocationID = resolveReasonsLocationID(locIds)

      const mergedBase = baseFields.map((base) => {
        if (!base?.name || !inferredByName.has(base.name)) return base
        const imp = inferredByName.get(base.name)
        inferredByName.delete(base.name)
        return {
          ...base,
          type: imp.type === 'phone' || base.name === 'phoneNumber' ? 'phone' : base.type,
          label: imp.label && imp.label.trim() ? imp.label : base.label,
          placeholder: imp.placeholder != null ? imp.placeholder : base.placeholder,
          required: typeof imp.required === 'boolean' ? imp.required : base.required,
          defaultValue: imp.defaultValue != null && imp.defaultValue !== '' ? imp.defaultValue : base.defaultValue,
          submitHidden: Boolean(imp.submitHidden),
          styles: { ...(base.styles || {}), ...(imp.styles || {}) },
          ...(imp.defaultCountryCode || base.defaultCountryCode
            ? { defaultCountryCode: imp.defaultCountryCode || base.defaultCountryCode }
            : {}),
          ...(imp.defaultCountryIso || base.defaultCountryIso
            ? { defaultCountryIso: imp.defaultCountryIso || base.defaultCountryIso }
            : {}),
          options:
            base.name === 'reason'
              ? sanitizeReasonOptions(
                  imp.options?.length ? imp.options : base.options
                )
              : base.optionsLocked || base.name === 'locationID'
                ? base.options
                : imp.options?.length
                  ? imp.options
                  : base.options,
          ...(base.name === 'reason' && importReasonsLocationID
            ? { reasonsLocationID: importReasonsLocationID }
            : {}),
        }
      })

      const PHONE_JUNK = new Set(['phoneLocal', 'phoneCountryCode'])
      const leftover = [...inferredByName.values()].filter(
        (f) =>
          f &&
          f.name &&
          !SYSTEM_HIDDEN_FIELD_NAMES.has(f.name) &&
          !PHONE_JUNK.has(f.name)
      )
      const layoutExtras = inferred.filter((f) => f?.type === 'heading' || f?.type === 'captcha')

      const nextFields = sanitizeFormFields([
        ...mergedBase,
        ...leftover.filter((f) => f.type !== 'heading' && f.type !== 'captcha'),
        ...layoutExtras,
      ])

      setFormFields(pinHeadingsToTop(nextFields))
      setReasonOptionsBaseline(getReasonOptionsFromFields(nextFields))
      const meta = parseGlobalStylesMeta(htmlCode)
      // Always replace — form CSS is per-form and must not carry over from the previous form
      setGlobalStyles(meta.styles && typeof meta.styles === 'object' ? { ...meta.styles } : {})
      setGlobalStyleExcludeKeys(Array.isArray(meta.excludeKeys) ? [...meta.excludeKeys] : [])
      setSettingsPanelMode('field')
      const firstVisible = nextFields.find((f) => f && !f.hidden && f.type !== 'hidden')
      setSelectedField(firstVisible?.id || null)
      setActiveTab('builder')
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Import failed', message: 'Could not open this form in the builder.' })
    }
  }

  const usedLeadPropertyNames = new Set(
    formFields
      .filter((f) => f?.name && LEAD_PROPERTY_NAMES.has(f.name))
      .map((f) => f.name)
  )

  const addLeadProperty = (property) => {
    if (!property?.name) return
    if (usedLeadPropertyNames.has(property.name)) {
      toast.error({ title: 'Already added', message: `${property.label} is already on this form.` })
      return
    }
    const newField = createLeadPropertyField(property, {
      leadReasons,
      locations,
      locked: false,
      required: false,
    })
    setFormFields((prev) => pinHeadingsToTop([...prev, newField]))
    setSelectedField(newField.id)
  }

  const addMetadataField = (type = 'text') => {
    const typeMeta = CUSTOM_FIELD_TYPES.find((t) => t.id === type)
    const newField = createMetadataField(type, typeMeta?.name || 'Custom field')
    setFormFields((prev) => pinHeadingsToTop([...prev, newField]))
    setSelectedField(newField.id)
    setShowCustomFieldTypes(false)
  }

  const addFormElement = (element) => {
    if (!element?.type) return
    if (element.type === 'heading') {
      const newField = {
        id: `heading-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        type: 'heading',
        label: 'Heading',
        headingLevel: 'h2',
        placeholder: '',
        required: false,
        propertyKind: 'layout',
        styles: {
          textAlign: 'left',
          blockAlign: 'left',
          width: '100%',
        },
      }
      // Always insert heading at the top of the form (after system fields)
      setFormFields((prev) => pinHeadingsToTop([newField, ...prev]))
      setSelectedField(newField.id)
    }
  }

  const addCaptchaField = (captchaType = 'robot') => {
    const already = formFields.find((f) => f.type === 'captcha')
    if (already) {
      const meta = getCaptchaTypeMeta(captchaType)
      if (already.captchaType === meta.id) {
        setSelectedField(already.id)
        setShowCaptchaTypes(false)
        return
      }
      const updated = {
        ...already,
        captchaType: meta.id,
        label: meta.label,
        required: true,
      }
      setFormFields((prev) => prev.map((f) => (f.id === already.id ? updated : f)))
      setSelectedField(already.id)
      setShowCaptchaTypes(false)
      return
    }
    const newField = createCaptchaField(captchaType)
    setFormFields((prev) => pinHeadingsToTop([...prev, newField]))
    setSelectedField(newField.id)
    setShowCaptchaTypes(false)
  }

  const addField = (type) => {
    const fieldType = fieldTypes.find((ft) => ft.id === type)
    const baseLabel = fieldType?.name || `New ${type} field`
    const slug = baseLabel.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    let uniqueName = slug || `field_${Date.now()}`
    const existing = new Set(formFields.map((f) => getFieldNameForHtml(f)))
    let i = 2
    while (existing.has(uniqueName) || RESERVED_FIELD_NAMES.has(uniqueName)) {
      uniqueName = `${slug}_${i}`
      i += 1
    }
    const newField = {
      id: Date.now().toString(),
      type,
      name: uniqueName,
      label: baseLabel,
      placeholder: `Enter ${type}...`,
      required: false,
      propertyKind: 'custom',
      styles: {},
      options:
        type === 'select'
          ? [{ label: 'Option 1', value: 'option_1' }]
          : type === 'checkbox'
            ? [{ label: 'Option 1', value: 'option_1' }]
            : [],
    }
    setFormFields((prev) => pinHeadingsToTop([...prev, newField]))
    setSelectedField(newField.id)
  }

  const applyTemplate = (templateId) => {
    const fields = templateFields[templateId] || []
    const normalized = fields.map((field, index) => ({
      ...field,
      id: `${templateId}-${index}-${Date.now()}`,
      styles: {},
    }))
    const filtered = normalized.filter((f) => !REQUIRED_FIELD_NAMES.has(getFieldNameForHtml(f)))
    setBuilderFormType('blank')
    setFormFields([...REQUIRED_SYSTEM_FIELDS, ...filtered])
    setSelectedField(normalized[0]?.id || null)
    setGlobalStyles({})
    setGlobalStyleExcludeKeys([])
    setSettingsPanelMode('field')
    setActiveTab('builder')
  }

  const removeField = (id) => {
    const field = formFields.find((f) => f.id === id)
    // Always allow removing phone-widget junk, even if somehow marked locked
    if (field?.locked && !isPhoneWidgetJunkField(field)) return
    setFormFields((prev) => sanitizeFormFields(prev.filter((f) => f.id !== id)))
    if (selectedField === id) setSelectedField(null)
  }

  const purgePhoneJunkFields = () => {
    setFormFields((prev) => {
      const next = sanitizeFormFields(prev)
      const removed = prev.length - next.length
      if (removed > 0) {
        toast.success({
          title: 'Cleaned up',
          message: `Removed ${removed} invalid phone helper field${removed === 1 ? '' : 's'}.`,
        })
      } else {
        toast.success({ title: 'Already clean', message: 'No phone helper fields found.' })
      }
      return next
    })
  }

  const handleDragStart = (event) => {
    setActiveId(event.active.id)
  }

  const handleDragEnd = (event) => {
    const { active, over } = event

    if (!over) {
      setActiveId(null)
      return
    }

    const activeIdStr = active.id.toString()

    if (activeIdStr.startsWith('lead-prop-')) {
      const propId = activeIdStr.replace('lead-prop-', '')
      const property = LEAD_PROPERTIES.find((p) => p.id === propId)
      if (property) addLeadProperty(property)
      setActiveId(null)
      return
    }

    if (activeIdStr.startsWith('form-el-')) {
      const elId = activeIdStr.replace('form-el-', '')
      if (elId.startsWith('captcha-')) {
        const captchaType = elId.replace('captcha-', '')
        addCaptchaField(captchaType)
        setActiveId(null)
        return
      }
      const element = FORM_ELEMENTS.find((e) => e.id === elId)
      if (element) addFormElement(element)
      setActiveId(null)
      return
    }

    if (activeIdStr.startsWith('field-type-')) {
      const fieldTypeId = activeIdStr.replace('field-type-', '')
      const fieldType = fieldTypes.find((ft) => ft.id === fieldTypeId)
      if (fieldType) addField(fieldType.id)
      setActiveId(null)
      return
    }

    // Handle reordering existing fields
    if (active.id !== over.id) {
      const activeIndex = formFields.findIndex((item) => item.id === active.id)
      const overIndex = formFields.findIndex((item) => item.id === over.id)

      if (activeIndex !== -1 && overIndex !== -1) {
        setFormFields((items) => pinHeadingsToTop(arrayMove(items, activeIndex, overIndex)))
      }
    }

    setActiveId(null)
  }

  const handleFieldUpdate = (updatedField) => {
    if (updatedField.id === 'submit-button' || updatedField.type === 'submit') {
      setSubmitButton(updatedField)
    } else {
      // Never let label edits overwrite fixed lead property names
      let next = { ...updatedField }
      if (next.propertyKind === 'lead' || LEAD_PROPERTY_NAMES.has(next.name)) {
        const catalog = LEAD_PROPERTIES.find((p) => p.name === next.name)
        if (catalog) next.name = catalog.name
      }
      if (next.propertyKind === 'metadata' || next.metadataKey) {
        const key = String(next.metadataKey || '')
          .trim()
          .replace(/[^\w.-]/g, '_')
          .replace(/^_+|_+$/g, '')
        next.metadataKey = key || next.metadataKey
        next.name = `metadata.${next.metadataKey}`
      }
      // Captcha is always required when present on the form
      if (next.type === 'captcha') {
        next.required = true
      }
      setFormFields((prev) => prev.map((f) => (f.id === next.id ? next : f)))
    }
  }

  const getEffectiveFieldStyles = (field) => {
    const excluded = isExcludedFromGlobalStyles(field, globalStyleExcludeKeys)
    return mergeFieldStyles(globalStyles, field?.styles || {}, excluded)
  }

  const generateFieldHTML = (field) => {
    if (isPhoneWidgetJunkField(field)) return ''

    const fieldName = escapeHtmlAttr(getFieldNameForHtml(field))
    const defaultVal = field.defaultValue != null ? String(field.defaultValue) : ''
    const escapedDefault = escapeHtmlAttr(defaultVal)

    if (isSystemHiddenField(field)) {
      if (field.name === 'organisationID') {
        return `<input type="hidden" name="organisationID" value="${organisationID}" />`
      }
      if (field.name === 'formID') {
        // Unsaved forms have no id yet — omit the field so Mongoose doesn't cast "".
        if (!formID) return ''
        return `<input type="hidden" name="formID" value="${formID}" />`
      }
      return `<input type="hidden" name="${fieldName}" value="${escapedDefault}" />`
    }

    if (field.submitHidden) {
      return `<input type="hidden" name="${fieldName}" value="${escapedDefault}" />`
    }

    const fieldStyles = getEffectiveFieldStyles(field)

    if (field.type === 'heading') {
      const tag = resolveHeadingTag(field.headingLevel)
      const box = buildHeadingBoxStyle(fieldStyles)
      const text = buildHeadingTextStyle(fieldStyles)
      const boxCss = Object.entries(box)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v}`)
        .join('; ')
      const textCss = Object.entries(text)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}: ${v}`)
        .join('; ')
      return `<div style="${boxCss}; margin-bottom: 1rem"><${tag} style="${textCss}">${escapeHtmlAttr(field.label || 'Heading')}</${tag}></div>`
    }

    if (field.type === 'captcha') {
      return getCaptchaExportMarkup(field)
    }

    const styleString = buildInputCssString(fieldStyles)
    const labelStyleString = buildLabelCssString(fieldStyles)

    let fieldHTML = ''
    
    if (field.type === 'textarea') {
      fieldHTML = `<textarea 
        name="${fieldName}" 
        placeholder="${escapeHtmlAttr(field.placeholder || '')}" 
        ${field.required ? 'required' : ''}
        style="${styleString}"
        rows="3"
      >${escapedDefault}</textarea>`
    } else if (field.type === 'select') {
      const optsHtml = (field.options || []).map(opt => {
        const v = escapeHtmlAttr((opt.value || opt.label || '').toString())
        const l = escapeHtmlAttr((opt.label || opt.value || '').toString())
        const selected = defaultVal && v === defaultVal ? ' selected' : ''
        return `<option value="${v}"${selected}>${l}</option>`
      }).join('')
      fieldHTML = `<select 
        name="${fieldName}" 
        ${field.required ? 'required' : ''}
        style="${styleString}"
      >
        <option value="">${escapeHtmlAttr(getSelectPlaceholder(field))}</option>
        ${optsHtml}
      </select>`
    } else if (field.type === 'checkbox') {
      const optsHtml = (field.options || []).map((opt, idx) => {
        const v = (opt.value || opt.label || `option_${idx+1}`).toString().replace(/"/g, '&quot;')
        const l = (opt.label || opt.value || `Option ${idx+1}`).toString().replace(/"/g, '&quot;')
        const id = `${field.id}_${v}`
        return `<div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.25rem;">
          <input type="checkbox" name="${fieldName}[]" id="${id}" value="${v}" ${field.required ? 'required' : ''} style="width: auto;" />
          <label for="${id}" style="font-size:0.875rem; color:#475569;">${l}</label>
        </div>`
      }).join('')
      fieldHTML = optsHtml || `<div style="display:flex; align-items:center; gap:0.5rem;">
        <input type="checkbox" name="${fieldName}" id="${field.id}" ${field.required ? 'required' : ''} style="width: auto;" />
        <label for="${field.id}" style="font-size:0.875rem; color:#475569;">${field.placeholder || 'Checkbox option'}</label>
      </div>`
    } else if (field.type === 'rating') {
      fieldHTML = `<div style="display: flex; gap: 0.25rem; align-items: center;">
        ${[1, 2, 3, 4, 5].map(star => `
          <input 
            type="radio" 
            name="${fieldName}" 
            value="${star}" 
            id="${field.id}_${star}"
            ${field.required ? 'required' : ''}
            style="display: none;"
          />
          <label 
            for="${field.id}_${star}" 
            style="font-size: 1.5rem; cursor: pointer; color: #cbd5e1;"
            onmouseover="this.style.color='#fbbf24'"
            onmouseout="this.style.color='#cbd5e1'"
          >★</label>
        `).join('')}
      </div>`
    } else if (field.type === 'phone' || field.name === 'phoneNumber') {
      fieldHTML = getFormPhoneExportMarkup(field, {
        fieldName,
        styleString,
        escapeHtmlAttr,
        required: Boolean(field.required),
      })
    } else {
      fieldHTML = `<input 
        type="${field.type}" 
        name="${fieldName}" 
        placeholder="${escapeHtmlAttr(field.placeholder || '')}" 
        ${defaultVal ? `value="${escapedDefault}"` : ''}
        ${field.required ? 'required' : ''}
        style="${styleString}"
      />`
    }

    if (field.type === 'phone' || field.name === 'phoneNumber') {
      return `<div style="margin-bottom: 1rem;">${fieldHTML}</div>`
    }

    return `
      <div style="margin-bottom: 1rem;">
        <label style="display: block; margin-bottom: 0.5rem; ${labelStyleString};">
          ${field.label}
          ${field.required ? '<span style="color: #ef4444; margin-left: 0.25rem;">*</span>' : ''}
        </label>
        ${fieldHTML}
      </div>
    `
  }

  const generateExportedHTML = () => {
    if (formFields.length === 0) {
      return ''
    }

    // De-dupe by HTML field name to avoid FormData arrays + duplicated UI fields
    const seenNames = new Set()
    const fieldsHTML = sanitizeFormFields(formFields)
      .filter((field) => {
        const key = getFieldNameForHtml(field)
        if (!key) return field?.type === 'heading' || field?.type === 'captcha'
        if (seenNames.has(key)) return false
        seenNames.add(key)
        return true
      })
      .map((field) => generateFieldHTML(field))
      .filter(Boolean)
      .join('\n')
    // Analytics snippet injected into exported HTML <head>
    const gtagScript = `  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-4PKNTJ6CWT"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());

    gtag('config', 'G-4PKNTJ6CWT');
  </script>
`

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  ${normalizeStandaloneRedirectUrl(redirectUrl) ? `<meta name="cadance-redirect-url" content="${String(normalizeStandaloneRedirectUrl(redirectUrl)).replace(/"/g, '&quot;')}">` : ''}
  <title>Form</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      ${buildFormPageCss(globalStyles)}
      background-attachment: fixed;
      padding: 2rem;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .form-container {
      ${buildFormContainerCss(globalStyles)}
      padding: 2rem;
      border-radius: 0.5rem;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06);
      width: 100%;
      max-width: 600px;
    }
    .form-container h2 {
      margin-bottom: 1.5rem;
      color: #1e293b;
      font-size: 1.5rem;
      font-weight: 600;
    }
    .form-container form {
      display: flex;
      flex-direction: column;
    }
    .form-container input[type="text"],
    .form-container input[type="email"],
    .form-container input[type="tel"],
    .form-container input[type="date"],
    .form-container input[type="file"],
    .form-container textarea,
    .form-container select {
      width: 100%;
      outline: none;
      transition: all 0.2s;
    }
    .form-container input[type="text"]:focus,
    .form-container input[type="email"]:focus,
    .form-container input[type="tel"]:focus,
    .form-container input[type="date"]:focus,
    .form-container textarea:focus,
    .form-container select:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }
    /* Phone widget — themable via --cadance-input-* so host CSS can restyle the whole control */
    .crm-phone-field {
      width: 100%;
    }
    .crm-phone-shell,
    .crm-phone-flag-btn,
    .crm-phone-dropdown {
      background: var(--cadance-input-bg, #fff);
      color: var(--cadance-input-text, #0f172a);
      border-color: var(--cadance-input-border, #cbd5e1);
    }
    .crm-phone-flag-btn {
      background: transparent;
    }
    .crm-phone-local,
    .crm-phone-dial,
    .crm-phone-search {
      color: var(--cadance-input-text, #0f172a);
      background: transparent;
    }
    .crm-phone-label,
    .crm-phone-caret {
      color: var(--cadance-muted-text, #94a3b8);
    }
    .submit-btn {
      background: ${submitButton.styles?.backgroundColor || '#2563eb'};
      color: ${submitButton.styles?.color || 'white'};
      ${submitButton.styles?.borderWidth ? `border: ${submitButton.styles.borderWidth} ${submitButton.styles.borderStyle || 'solid'} ${submitButton.styles.borderColor || '#e2e8f0'};` : 'border: none;'}
      padding: ${submitButton.styles?.paddingTop || '0.75rem'} ${submitButton.styles?.paddingRight || '1.5rem'} ${submitButton.styles?.paddingBottom || '0.75rem'} ${submitButton.styles?.paddingLeft || '1.5rem'};
      border-radius: ${submitButton.styles?.borderRadius || '0.375rem'};
      font-size: ${submitButton.styles?.fontSize || '1rem'};
      font-weight: ${submitButton.styles?.fontWeight || '500'};
      font-family: ${submitButton.styles?.fontFamily || 'inherit'};
      ${submitButton.styles?.letterSpacing ? `letter-spacing: ${submitButton.styles.letterSpacing};` : ''}
      ${submitButton.styles?.textAlign ? `text-align: ${submitButton.styles.textAlign};` : ''}
      ${submitButton.styles?.textTransform ? `text-transform: ${submitButton.styles.textTransform};` : ''}
      cursor: pointer;
      margin-top: ${submitButton.styles?.marginTop || '1.5rem'};
      margin-right: ${submitButton.styles?.marginRight || '0'};
      margin-bottom: ${submitButton.styles?.marginBottom || '0'};
      margin-left: ${submitButton.styles?.marginLeft || '0'};
      width: ${submitButton.styles?.width || '100%'};
      transition: opacity 0.2s;
      box-sizing: border-box;
    }
    .submit-btn:hover {
      opacity: 0.9;
    }
    .submit-btn:active {
      opacity: 0.8;
    }
    .crm-toast-host {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      pointer-events: none;
      max-width: min(360px, calc(100vw - 2rem));
    }
    .crm-toast {
      pointer-events: auto;
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      border-radius: 0.75rem;
      background: #0f172a;
      color: #f8fafc;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.25);
      font-size: 0.875rem;
      line-height: 1.4;
      animation: crm-toast-in 0.22s ease-out;
    }
    .crm-toast--success { background: #065f46; }
    .crm-toast--error { background: #9f1239; }
    .crm-toast__title {
      font-weight: 600;
      margin-bottom: 0.15rem;
    }
    .crm-toast__message { opacity: 0.95; }
    @keyframes crm-toast-in {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
${gtagScript}
  ${embedGlobalStylesMeta(globalStyles, globalStyleExcludeKeys)}
</head>
<body>
  <div class="form-container">
    <form id="exportedForm" action="#" method="POST">
      ${fieldsHTML}
      <button type="submit" class="submit-btn">${submitButton.label}</button>
    </form>
  </div>
  <div class="crm-toast-host" id="crmToastHost" aria-live="polite"></div>
  <script>
${getCaptchaExportRuntimeScript()}
${getFormPhoneExportRuntimeScript()}
    (function() {
      var REDIRECT_URL = ${JSON.stringify(normalizeStandaloneRedirectUrl(redirectUrl))};

      function toAbsoluteRedirect(url) {
        if (!url) return '';
        var s = String(url).trim();
        if (!s) return '';
        var matches = s.match(/https?:\\/\\/[^\\s"']+/gi);
        if (matches && matches.length > 1) s = matches[matches.length - 1];
        var wwwTail = s.match(/^(https?:\\/\\/.+)\\/(www\\.[a-z0-9.-]+\\.[a-z]{2,})(\\/.*)?$/i);
        if (wwwTail) s = 'https://' + wwwTail[2] + (wwwTail[3] || '');
        if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
        if (s.indexOf('//') === 0) return 'https:' + s;
        return 'https://' + s.replace(/^\\/+/, '');
      }

      function goToRedirect() {
        var target = toAbsoluteRedirect(REDIRECT_URL);
        if (!target) return false;
        try {
          var w = window.top || window;
          w.location.assign(target);
          return true;
        } catch (e) {
          try {
            window.location.assign(target);
            return true;
          } catch (e2) {
            return false;
          }
        }
      }

      function showToast(type, title, message) {
        var host = document.getElementById('crmToastHost');
        if (!host) return;
        var el = document.createElement('div');
        el.className = 'crm-toast crm-toast--' + (type === 'success' ? 'success' : 'error');
        el.innerHTML =
          '<div>' +
            '<div class="crm-toast__title"></div>' +
            (message ? '<div class="crm-toast__message"></div>' : '') +
          '</div>';
        el.querySelector('.crm-toast__title').textContent = title || '';
        var msgEl = el.querySelector('.crm-toast__message');
        if (msgEl) msgEl.textContent = message || '';
        host.appendChild(el);
        setTimeout(function() {
          el.style.opacity = '0';
          el.style.transition = 'opacity 0.2s ease';
          setTimeout(function() { el.remove(); }, 220);
        }, 3200);
      }

      const form = document.getElementById('exportedForm');
      if (form) {
        form.addEventListener('submit', async function(event) {
          event.preventDefault();

          if (typeof window.__crmValidateCaptchas === 'function' && !window.__crmValidateCaptchas()) {
            return;
          }

          if (typeof window.__crmSyncPhones === 'function') {
            window.__crmSyncPhones(form);
          }

          // Capture page URL (prefer top-level URL; fallback to referrer / iframe URL)
          let capturedUrl = '';
          try {
            capturedUrl = (window.top && window.top.location && window.top.location.href) ? window.top.location.href : '';
          } catch (e) {
            capturedUrl = '';
          }
          if (!capturedUrl) capturedUrl = document.referrer || '';
          if (!capturedUrl) capturedUrl = window.location.href || '';

          const urlInput = form.querySelector('input[name="url"]');
          if (urlInput) urlInput.value = capturedUrl;

          const formData = new FormData(form);
          const payload = {};

          formData.forEach((value, key) => {
            const normalizedKey = key.endsWith('[]') ? key.slice(0, -2) : key;
            if (payload[normalizedKey] === undefined) payload[normalizedKey] = value;
            else if (Array.isArray(payload[normalizedKey])) payload[normalizedKey].push(value);
            else payload[normalizedKey] = [payload[normalizedKey], value];
          });

          const pickFirst = (v) => Array.isArray(v) ? v[0] : v;

          // Nest metadata[key] entries into payload.metadata
          const metadata = {};
          Object.keys(payload).forEach((key) => {
            const match = key.match(/^metadata\\[(.+)\\]$/);
            if (match) {
              metadata[match[1]] = pickFirst(payload[key]);
              delete payload[key];
            }
          });
          if (Object.keys(metadata).length > 0) payload.metadata = metadata;

          payload.name = payload.name || pickFirst(payload.full_name) || pickFirst(payload.student_name) || pickFirst(payload.parent_name);
          payload.email = payload.email || pickFirst(payload.email_address) || pickFirst(payload.parent_email);
          payload.phoneNumber = pickFirst(payload.phoneNumber) || pickFirst(payload.phone) || pickFirst(payload.phone_number);
          delete payload.phoneCountryCode;
          delete payload.phoneLocal;
          delete payload.phone;
          payload.reason = pickFirst(payload.reason);
          payload.locationID = pickFirst(payload.locationID);
          payload.location = pickFirst(payload.location);
          payload.utm_source = pickFirst(payload.utm_source) || null;
          payload.url = capturedUrl;
          // Safety: ensure backend required ids are scalar even if duplicated somehow
          payload.organisationID = pickFirst(payload.organisationID);
          payload.formID = pickFirst(payload.formID);
          if (!payload.formID) delete payload.formID;
          delete payload.captcha;
          delete payload.captcha_images;

          try {
            const res = await fetch('https://backend.cadance.ai/api/lead/form', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => null);
            if (res.ok) {
              if (goToRedirect()) return;
              showToast('success', 'Form submitted successfully!', 'Thanks — we received your details.');
              form.reset();
            } else {
              showToast('error', 'Form submission failed', body?.message || 'Please try again.');
            }
          } catch (err) {
            showToast('error', 'Network error', 'Could not submit the form. Please try again.');
          }
        });
      }

      // Rating star interaction
      document.querySelectorAll('input[type="radio"][name*="rating"]').forEach(radio => {
        radio.addEventListener('change', function() {
          const name = this.name;
          const value = parseInt(this.value);
          document.querySelectorAll('input[type="radio"][name="' + name + '"]').forEach((r, index) => {
            const label = document.querySelector('label[for="' + r.id + '"]');
            if (index < value) {
              label.style.color = '#fbbf24';
            } else {
              label.style.color = '#cbd5e1';
            }
          });
        });
      });
    })();
  </script>
</body>
</html>`
  }

  const exportAsHTML = () => {
    if (formFields.length === 0) {
      alert('Please add at least one field to export the form.')
      return
    }

    const htmlContent = generateExportedHTML()
    setExportedHTML(htmlContent)

    if (!editingFormId) {
      toast.info({
        title: 'Save the form first',
        message: 'Embed code and share link need a saved form. Save first, or download the full HTML.',
      })
      setEmbedCode('')
      setShareLink('')
      setExportTab('html')
    } else {
      const apiBase = getApiBaseUrl()
      setEmbedCode(buildFormEmbedCode(editingFormId, { apiBase }))
      setShareLink(buildFormShareLink(editingFormId, { apiBase }))
      setExportTab('embed')
    }
    setShowExport(true)
  }

  const openEmbedPreview = () => {
    const code = String(embedCode || '').trim()
    if (!code) {
      toast.info({
        title: 'No embed code',
        message: 'Save the form first to generate embed code, then try again.',
      })
      return
    }
    try {
      localStorage.setItem('cadance-embed-preview-code', code)
    } catch {
      // ignore quota / private mode
    }
    window.open('/marketing/form-builder/embed-preview', '_blank', 'noopener,noreferrer')
  }

  const copyExportValue = (value) => {
    const text = String(value || '')
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      toast.success({ title: 'Copied', message: 'Copied to clipboard.' })
    }).catch(() => {
      const textArea = document.createElement('textarea')
      textArea.value = text
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
      toast.success({ title: 'Copied', message: 'Copied to clipboard.' })
    })
  }

  const copyToClipboard = () => {
    if (exportTab === 'embed' && embedCode) return copyExportValue(embedCode)
    if (exportTab === 'share' && shareLink) return copyExportValue(shareLink)
    return copyExportValue(exportedHTML)
  }

  const downloadHTML = () => {
    const blob = new Blob([exportedHTML], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'form.html'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handlePreview = () => {
    setShowPreview(true)
  }

  const renderPreviewField = (field) => {
    if (field.submitHidden || isSystemHiddenField(field)) return null

    const fieldStyles = getEffectiveFieldStyles(field)
    const inputStyle = buildInputReactStyle(fieldStyles)
    const labelStyle = buildLabelReactStyle(fieldStyles)

    if (field.type === 'heading') {
      const Tag = resolveHeadingTag(field.headingLevel)
      return (
        <div key={field.id} style={{ marginBottom: '1rem' }}>
          <div style={buildHeadingBoxStyle(fieldStyles)}>
            <Tag style={buildHeadingTextStyle(fieldStyles)}>
              {field.label || 'Heading'}
            </Tag>
          </div>
        </div>
      )
    }

    if (field.type === 'captcha') {
      return (
        <div key={field.id} style={{ marginBottom: '1rem' }}>
          <DynamicCaptcha field={field} interactive />
        </div>
      )
    }

    return (
      <div key={field.id} style={{ marginBottom: '1rem' }}>
        <Label className="block mb-2 w-full" style={labelStyle}>
          {field.label}
          {field.required && <span className="text-red-500 ml-1">*</span>}
        </Label>
        {field.type === 'textarea' ? (
          <textarea
            placeholder={field.placeholder}
            style={inputStyle}
            rows={3}
            className="w-full resize-none focus:outline-none focus:ring-2 focus:ring-brand"
          />
        ) : field.type === 'select' ? (
          <select
            style={inputStyle}
            className="w-full focus:outline-none focus:ring-2 focus:ring-brand"
            defaultValue={field.defaultValue || ''}
          >
            <option value="">{getSelectPlaceholder(field)}</option>
            {(field.options || []).map((opt) => (
              <option key={opt.value || opt.label} value={opt.value || opt.label}>
                {opt.label || opt.value}
              </option>
            ))}
          </select>
        ) : field.type === 'checkbox' ? (
          <div className="flex flex-col gap-2">
            {(field.options && field.options.length > 0) ? (
              field.options.map((opt, idx) => (
                <div key={opt.value || opt.label || idx} className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 text-brand" />
                  <span className="text-sm text-slate-600">{opt.label || opt.value}</span>
                </div>
              ))
            ) : (
              <div className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 text-brand" />
                <span className="text-sm text-slate-600">{field.placeholder || 'Checkbox option'}</span>
              </div>
            )}
          </div>
        ) : field.type === 'rating' ? (
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map(star => (
              <span key={star} className="text-2xl text-yellow-400 cursor-pointer">★</span>
            ))}
          </div>
        ) : field.type === 'phone' || field.name === 'phoneNumber' ? (
          <FormPhoneInput
            label={field.label || 'Phone number'}
            required={Boolean(field.required)}
            placeholder={field.placeholder || ''}
            countryCode={field.defaultCountryCode || DEFAULT_PHONE_COUNTRY_CODE}
            countryIso={field.defaultCountryIso || DEFAULT_PHONE_COUNTRY_ISO}
            value={field.defaultValue || ''}
            style={inputStyle}
          />
        ) : (
          <Input
            type={field.type}
            placeholder={field.placeholder}
            defaultValue={field.defaultValue || ''}
            style={inputStyle}
            className="focus:outline-none focus:ring-2 focus:ring-brand"
          />
        )}
      </div>
    )
  }

  const selectedFieldData = selectedField === 'submit-button' 
    ? submitButton 
    : formFields.find((f) => f.id === selectedField)

  const formsEmpty = hasBuckets
    ? ownTemplates.length === 0 && orgDefaultTemplates.length === 0 && globalTemplates.length === 0
    : forms.length === 0

  const renderFormCard = (form) => {
    const variant = templateScopeVariant(form)
    const isOwn = variant === 'own'
    const isOrgDefault = variant === 'org_default'
    const isGlobal = variant === 'global'
    const badge = templateScopeBadge(variant)
    const isInactive = isGlobal
      ? form.studioActivationStatus !== 'active'
      : form.status === 'inactive'
    const canEditTemplate = isOrgDefault
      ? manageDefaults
      : isGlobal
        ? superAdmin
        : true
    const canDeleteTemplate =
      canDeleteForms &&
      (isOwn || (isOrgDefault && manageDefaults) || (isGlobal && superAdmin))
    const showStatusSwitch = isOwn || (isOrgDefault && manageDefaults) || isGlobal
    const busy = togglingIds.has(form._id) || cloningFormId === form._id || deletingFormId === form._id

    return (
      <Card
        key={form._id}
        className={cn(
          'relative hover:shadow-lg transition-all duration-200',
          isInactive && 'opacity-60',
        )}
      >
        <div className="absolute top-3 right-3 flex items-center gap-1">
          {badge ? (
            <span
              className={cn(
                'mr-1 inline-flex h-6 items-center rounded-full px-2 text-[10px] font-semibold',
                badge.className,
              )}
            >
              {badge.label}
            </span>
          ) : null}
          {showStatusSwitch ? (
            <Switch
              checked={!isInactive}
              onChange={() => toggleFormStatus(form)}
              disabled={busy}
              title={isInactive ? 'Set active' : 'Set inactive'}
              className="disabled:opacity-40 scale-75"
            />
          ) : null}
          {isOwn ? (
            <button
              type="button"
              onClick={() => toggleFormFavorite(form)}
              disabled={busy}
              title={form.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              className={cn(
                'h-7 w-7 flex items-center justify-center rounded-full transition-all duration-200 disabled:opacity-40',
                form.isFavorite
                  ? 'text-red-500 hover:bg-red-50'
                  : 'text-muted-foreground hover:bg-muted hover:text-red-400',
              )}
            >
              <Heart
                className={cn(
                  'h-4 w-4 transition-all duration-200',
                  form.isFavorite && 'fill-current',
                  heartAnimIds.has(form._id) && 'scale-125',
                )}
              />
            </button>
          ) : null}
        </div>

        <CardHeader className="pr-24">
          <div className="flex items-start mb-2 gap-3">
            <div className="h-12 w-12 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
              <FileText className="h-6 w-6 text-slate-600" />
            </div>
          </div>
          <CardTitle className="text-lg line-clamp-1">{form.name}</CardTitle>
          {form.description && (
            <p className="text-sm text-slate-500 line-clamp-2">{form.description}</p>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-3 mb-4">
            {form.url && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">URL</span>
                <span className="font-medium text-slate-900 truncate max-w-[160px]">{form.url}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Created</span>
              <span className="font-medium text-slate-900">{formatDate(form.createdAt)}</span>
            </div>
          </div>
          <div className="flex gap-2">
            {canEditTemplate ? (
              <Button
                variant="gradient"
                size="sm"
                className="flex-1"
                disabled={isOwn && isInactive}
                onClick={() => importFormIntoBuilder(form)}
              >
                <Eye className="h-3.5 w-3.5 mr-1.5" />
                Preview
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={(isOwn && isInactive) || cloningFormId === form._id || !canWriteForms}
              onClick={() => cloneForm(form)}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" />
              {cloningFormId === form._id ? 'Cloning…' : 'Clone'}
            </Button>
            {canDeleteTemplate ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => deleteForm(form)}
                disabled={deletingFormId === form._id}
                title="Delete"
              >
                {deletingFormId === form._id
                  ? <GlobalLoader variant="inline" size="xs" />
                  : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            ) : null}
          </div>

          {manageDefaults && isOwn ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={busy}
              onClick={() => openScopeDialog(form, 'promote')}
            >
              <Star className="mr-1.5 h-3.5 w-3.5" />
              Mark as default
            </Button>
          ) : null}

          {manageDefaults && (isOrgDefault || (isGlobal && superAdmin)) ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              disabled={busy}
              onClick={() => openScopeDialog(form, 'change')}
            >
              Change scope
            </Button>
          ) : null}

          {isOrgDefault && !manageDefaults ? (
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Organisation template — clone to customize for your location.
            </p>
          ) : null}
          {isGlobal && !superAdmin ? (
            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              Global template — use the switch to opt your studio in or out. Clone to customize.
            </p>
          ) : null}
        </CardContent>
      </Card>
    )
  }

  const renderFormSection = ({ title, subtitle, items, emptyLabel }) => (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {emptyLabel}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map(renderFormCard)}
        </div>
      )}
    </section>
  )

  return (
    <MainLayout
      title="Form Builder"
      subtitle="Create and manage forms"
      mainClassName={
        activeTab === 'builder'
          ? 'flex flex-col overflow-hidden !py-2'
          : undefined
      }
    >
      <div
        className={
          activeTab === 'builder'
            ? 'flex min-h-0 flex-1 flex-col'
            : 'flex min-h-full flex-col space-y-6'
        }
      >
        {/* Templates View */}
        {activeTab === 'templates' && (
          <div className="space-y-6 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between">
              <p className="text-slate-600">Browse and manage your forms</p>
              {canWriteForms && (
                <Button variant="gradient" onClick={openBuilderForNew}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create New Form
                </Button>
              )}
            </div>

            {/* Search */}
            <SearchInput
              className="max-w-sm"
              placeholder="Search forms…"
              value={formsSearch}
              onChange={(e) => setFormsSearch(e.target.value)}
            />

            {formsLoading && (
              <div className="flex items-center justify-center py-16">
                <GlobalLoader variant="inline" size="md" />
              </div>
            )}

            {formsError && !formsLoading && (
              <Card className="border-destructive/50 bg-destructive/5">
                <CardContent className="py-8 text-center">
                  <p className="text-sm font-medium text-destructive">{formsError}</p>
                  <div className="mt-4 flex justify-center">
                    <Button variant="outline" onClick={fetchForms}>Retry</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {!formsLoading && !formsError && formsEmpty && (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center">
                  <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
                    <FileText className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="font-medium text-muted-foreground">No forms yet</p>
                  <p className="text-sm text-muted-foreground mt-1">Create a blank form or a lead capture form to get started.</p>
                </CardContent>
              </Card>
            )}

            {!formsLoading && !formsError && !formsEmpty && (
              <>
                {hasBuckets ? (
                  <div className="space-y-8">
                    {renderFormSection({
                      title: 'Your forms',
                      subtitle: manageDefaults
                        ? 'Owned by this branch — mark one as an org or global default to share it.'
                        : 'Owned by this branch.',
                      items: ownTemplates,
                      emptyLabel: 'No studio forms yet.',
                    })}
                    {renderFormSection({
                      title: 'Organisation defaults',
                      subtitle:
                        'Org-wide templates (all branches). Status is shared — managed with Default Workflows permission.',
                      items: orgDefaultTemplates,
                      emptyLabel: 'No organisation default templates yet.',
                    })}
                    {renderFormSection({
                      title: 'Global templates',
                      subtitle: 'Shared across all studios — opt your studio in or out with the switch.',
                      items: globalTemplates,
                      emptyLabel: 'No global templates available yet.',
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {forms.map(renderFormCard)}
                  </div>
                )}

                {/* Pagination */}
                {formsTotalPages > 1 && (
                  <div className="flex items-center justify-between pt-2 mt-auto">
                    <button
                      type="button"
                      onClick={() => setFormsPage((p) => Math.max(1, p - 1))}
                      disabled={formsPage === 1 || formsLoading}
                      className="h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    <span className="text-sm text-muted-foreground">
                      Page {formsPage} of {formsTotalPages} ({formsTotalCount} total)
                    </span>
                    <button
                      type="button"
                      onClick={() => setFormsPage((p) => Math.min(formsTotalPages, p + 1))}
                      disabled={formsPage === formsTotalPages || formsLoading}
                      className="h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}

            <SetTemplateScopeDialog
              open={scopeDialogOpen}
              busy={scopeBusy}
              templateName={scopeTarget?.name}
              currentScope={scopeTarget?.currentScope}
              mode={scopeMode}
              entityLabel="form"
              onClose={() => {
                if (scopeBusy) return
                setScopeDialogOpen(false)
                setScopeTarget(null)
              }}
              onConfirm={confirmFormScope}
            />
          </div>
        )}

        {/* Form type picker (HubSpot-style) */}
        {activeTab === 'select-type' && (
          <div className="flex min-h-[calc(100vh-220px)] flex-col">
            <div className="mb-6 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={() => setActiveTab('templates')}
                className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to forms
              </button>
              <Button variant="gradient" onClick={() => startBuilderWithType(pendingFormType)}>
                Start
              </Button>
            </div>

            <div className="mb-8">
              <h2 className="text-2xl font-semibold text-foreground">Select a form type</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose how you want to start building your form.
              </p>
            </div>

            <div className="grid flex-1 gap-6 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-5">
                {FORM_TYPE_OPTIONS.map((option) => {
                  const Icon = option.icon
                  const selected = pendingFormType === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setPendingFormType(option.id)}
                      className={`w-full rounded-xl border p-4 text-left transition-all ${
                        selected
                          ? 'border-[color:var(--studio-primary)] bg-[color:var(--studio-primary)]/5 ring-1 ring-[color:var(--studio-primary)]/30'
                          : 'border-border bg-card hover:border-muted-foreground/30 hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                            selected ? 'bg-[color:var(--studio-primary)] text-white' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">{option.title}</div>
                          <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="lg:col-span-7">
                <div className="rounded-2xl border border-border bg-muted/20 p-4 sm:p-6">
                  <p className="mb-4 text-sm font-medium text-muted-foreground">Preview</p>
                  <div className="mx-auto max-w-lg rounded-xl border border-border bg-background p-3 shadow-sm">
                    <div className="mb-3 flex items-center gap-1.5 border-b border-border px-2 pb-3">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <FormTypePreview formType={pendingFormType} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Builder View */}
        {activeTab === 'builder' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                // Reset form-scoped styles when leaving the builder so they never leak to the next form
                if (editingFormId) {
                  setGlobalStyles({})
                  setGlobalStyleExcludeKeys([])
                  setSettingsPanelMode('field')
                }
                setActiveTab(editingFormId ? 'templates' : 'select-type')
              }}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            <Badge variant="secondary" className="capitalize">
              {builderFormType === 'lead' ? 'Lead form' : 'Blank form'}
            </Badge>
          </div>
          {/* Form name + description row */}
          <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
            <Input
              placeholder="Form name (required)"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="max-w-xs font-medium"
            />
            <Input
              placeholder="Description (optional)"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              className="max-w-sm"
            />
            <Input
              type="url"
              placeholder="Thank-you redirect URL (optional)"
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              onBlur={() => {
                setRedirectUrl((prev) => normalizeStandaloneRedirectUrl(prev))
              }}
              className="min-w-[280px] max-w-md"
              title="After a successful submit, visitors are sent to this page (full URL, e.g. https://example.com/thanks)"
            />
            <div
              id="form-builder-location"
              className={cn(
                'w-64 rounded-md',
                (!formLocationID ||
                  (formLocationID !== ALL_BRANCHES_VALUE &&
                    (!Array.isArray(formLocationID) || formLocationID.length === 0))) &&
                  'ring-2 ring-amber-400 ring-offset-1'
              )}
            >
              {(() => {
                const activeBranch = getEffectiveBranch()
                // Navbar branch selected → only that one studio is preselected (single-select).
                // Navbar "All branches" → multi-select as before.
                if (activeBranch) {
                  const singleValue =
                    formLocationID === ALL_BRANCHES_VALUE
                      ? ALL_BRANCHES_VALUE
                      : Array.isArray(formLocationID)
                        ? formLocationID[0] || String(activeBranch)
                        : formLocationID || String(activeBranch)
                  return (
                    <LocationSelector
                      value={singleValue}
                      onChange={(v) => {
                        if (v === ALL_BRANCHES_VALUE) {
                          setFormLocationID(ALL_BRANCHES_VALUE)
                          return
                        }
                        const id = Array.isArray(v) ? v[0] : v
                        setFormLocationID(id ? [String(id)] : [])
                      }}
                      multiple={false}
                      allowAllBranches
                      showAllOption={false}
                      preselectActiveBranch
                      placeholder="Studio required…"
                    />
                  )
                }
                return (
                  <LocationSelector
                    value={formLocationID}
                    onChange={setFormLocationID}
                    multiple
                    allowAllBranches
                    showAllOption={false}
                    preselectActiveBranch
                    placeholder="Studio(s) required…"
                  />
                )
              })()}
            </div>
            {editingFormId && (
              <span className="text-xs text-muted-foreground italic">Editing existing form</span>
            )}
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid min-h-0 flex-1 grid-cols-12 grid-rows-1 gap-4">
              {/* Properties palette */}
              <div className="col-span-3 flex min-h-0 flex-col self-stretch">
                <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                  <CardHeader className="flex-shrink-0 space-y-3 pb-3">
                    <div>
                      <CardTitle className="text-base">Properties</CardTitle>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Drag onto the form. Labels can change; internal names stay fixed.
                      </p>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={propertySearch}
                        onChange={(e) => setPropertySearch(e.target.value)}
                        placeholder="Search for properties and fields"
                        className="h-9 border-slate-200 bg-white pl-8 text-sm"
                      />
                    </div>
                  </CardHeader>
                  <CardContent
                    className="overflow-y-auto flex-1 space-y-1 pb-3 min-h-0"
                    style={{ overscrollBehavior: 'contain' }}
                  >
                    {(() => {
                      const q = propertySearch.trim().toLowerCase()
                      const matches = (prop) =>
                        !q ||
                        prop.label.toLowerCase().includes(q) ||
                        prop.name.toLowerCase().includes(q)
                      const leadProps = LEAD_PROPERTIES.filter(matches)
                      const formEls = FORM_ELEMENTS.filter(
                        (el) =>
                          !q ||
                          el.name.toLowerCase().includes(q) ||
                          el.type.toLowerCase().includes(q)
                      )
                      const showCaptcha =
                        !q ||
                        'captcha'.includes(q) ||
                        CAPTCHA_TYPES.some(
                          (t) =>
                            t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q)
                        )
                      const showCustom =
                        !q ||
                        'custom'.includes(q) ||
                        'metadata'.includes(q) ||
                        'add custom'.includes(q)
                      const currentCaptchaType = formFields.find((f) => f.type === 'captcha')?.captchaType
                      return (
                        <div className="space-y-1">
                          {leadProps.length === 0 && formEls.length === 0 && !showCaptcha && !showCustom ? (
                            <p className="px-1 py-2 text-xs text-slate-400">No matches</p>
                          ) : null}

                          {leadProps.map((prop) => (
                            <DraggableLeadProperty
                              key={prop.id}
                              property={prop}
                              used={usedLeadPropertyNames.has(prop.name)}
                              onAdd={addLeadProperty}
                            />
                          ))}

                          {formEls.map((element) => (
                            <DraggableFormElement
                              key={element.id}
                              element={element}
                              onAdd={addFormElement}
                            />
                          ))}

                          {showCaptcha ? (
                            <div className="space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowCaptchaTypes((v) => !v)
                                  setShowCustomFieldTypes(false)
                                }}
                                className={cn(
                                  'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm font-medium transition-colors',
                                  showCaptchaTypes
                                    ? 'border-sky-300 bg-sky-50 text-slate-800'
                                    : 'cursor-pointer border-transparent bg-sky-50/70 text-slate-700 hover:border-sky-200 hover:bg-sky-50'
                                )}
                              >
                                <ShieldCheck className="h-4 w-4 shrink-0 text-slate-500" />
                                <span className="flex-1 text-left">Captcha</span>
                                <ChevronDown
                                  className={cn(
                                    'h-3.5 w-3.5 text-slate-400 transition-transform',
                                    showCaptchaTypes && 'rotate-180'
                                  )}
                                />
                              </button>

                              {showCaptchaTypes ? (
                                <div className="ml-1 space-y-1 border-l-2 border-sky-100 pl-2">
                                  {CAPTCHA_TYPES.map((captchaType) => {
                                    const IconComponent = captchaType.icon
                                    const selected = currentCaptchaType === captchaType.id
                                    return (
                                      <button
                                        key={captchaType.id}
                                        type="button"
                                        onClick={() => addCaptchaField(captchaType.id)}
                                        className={cn(
                                          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                                          selected
                                            ? 'bg-sky-100 text-slate-800'
                                            : 'text-slate-700 hover:bg-sky-50'
                                        )}
                                      >
                                        <IconComponent className="h-4 w-4 shrink-0 text-slate-500" />
                                        <span className="text-left font-medium">{captchaType.name}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          {showCustom ? (
                            <div className="space-y-1 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowCustomFieldTypes((v) => !v)
                                  setShowCaptchaTypes(false)
                                }}
                                className={cn(
                                  'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm font-medium transition-colors',
                                  showCustomFieldTypes
                                    ? 'border-sky-300 bg-sky-50 text-slate-800'
                                    : 'border-dashed border-slate-300 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50/50'
                                )}
                              >
                                <Plus className="h-4 w-4 text-slate-500" />
                                <span className="flex-1 text-left">Add custom property</span>
                                <ChevronDown
                                  className={cn(
                                    'h-3.5 w-3.5 text-slate-400 transition-transform',
                                    showCustomFieldTypes && 'rotate-180'
                                  )}
                                />
                              </button>

                              {showCustomFieldTypes ? (
                                <div className="ml-1 space-y-1 border-l-2 border-sky-100 pl-2">
                                  {CUSTOM_FIELD_TYPES.map((fieldType) => {
                                    const IconComponent = fieldType.icon
                                    return (
                                      <button
                                        key={fieldType.id}
                                        type="button"
                                        onClick={() => addMetadataField(fieldType.id)}
                                        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-slate-700 hover:bg-sky-50"
                                      >
                                        <IconComponent className="h-4 w-4 shrink-0 text-slate-500" />
                                        <span className="text-left font-medium">{fieldType.name}</span>
                                      </button>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      )
                    })()}
                  </CardContent>
                </Card>
              </div>

              {/* Form Canvas */}
              <div className="col-span-6 flex min-h-0 flex-col">
                <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden border-slate-200">
                  <CardHeader className="flex-shrink-0 border-b border-slate-200 bg-white pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">Form editor</CardTitle>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Click a field to edit. Tags show lead mapping and hidden values.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {formFields.some(isPhoneWidgetJunkField) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={purgePhoneJunkFields}
                            className="border-amber-400 text-amber-800 hover:bg-amber-50"
                          >
                            Remove invalid phone fields
                          </Button>
                        ) : null}
                        <Button variant="gradient" size="sm" onClick={saveForm} disabled={savingForm}>
                          {savingForm ? 'Saving…' : (editingFormId ? 'Update Form' : 'Save Form')}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent
                    className="overflow-y-auto flex-1 p-0 min-h-0 bg-slate-100/60"
                    style={{ overscrollBehavior: 'contain' }}
                  >
                    <DroppableCanvas isEmpty={sanitizeFormFields(formFields).filter(isCanvasField).length === 0}>
                      {sanitizeFormFields(formFields).filter(isCanvasField).length === 0 ? (
                        <div className="m-4 rounded-lg border border-dashed border-slate-300 bg-white py-16 text-center">
                          <FileText className="mx-auto mb-4 h-12 w-12 text-slate-300" />
                          <p className="text-sm text-slate-500">
                            Drag components here or click to add
                          </p>
                        </div>
                      ) : (
                        <div
                          className="m-4 overflow-hidden rounded-lg border border-slate-200 shadow-sm"
                          style={{
                            background: resolveFormBackground(globalStyles).background,
                          }}
                        >
                          <SortableContext items={sanitizeFormFields(formFields).filter(isCanvasField).map((f) => f.id)} strategy={verticalListSortingStrategy}>
                            {sanitizeFormFields(formFields).filter(isCanvasField).map((field) => (
                              <SortableFieldItem
                                key={field.id}
                                field={field}
                                isSelected={selectedField === field.id}
                                onSelect={(id) => {
                                  setSelectedField(id)
                                  setSettingsPanelMode('field')
                                }}
                                onRemove={removeField}
                                globalStyles={globalStyles}
                                globalStyleExcludeKeys={globalStyleExcludeKeys}
                              />
                            ))}
                          </SortableContext>

                          <div
                            className={cn(
                              'border-t border-slate-200/80 px-5 py-5',
                              selectedField === 'submit-button' && 'ring-2 ring-inset ring-sky-300'
                            )}
                            style={{
                              background:
                                selectedField === 'submit-button'
                                  ? 'rgba(224, 242, 254, 0.55)'
                                  : 'transparent',
                            }}
                          >
                            <div
                              onClick={() => {
                                setSelectedField('submit-button')
                                setSettingsPanelMode('field')
                              }}
                              className="inline-block cursor-pointer"
                            >
                              <button
                                type="button"
                                className="rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                                style={{
                                  fontFamily: submitButton.styles?.fontFamily,
                                  fontSize: submitButton.styles?.fontSize,
                                  fontWeight: submitButton.styles?.fontWeight || 600,
                                  color: submitButton.styles?.color || '#ffffff',
                                  backgroundColor:
                                    submitButton.styles?.backgroundColor || 'var(--studio-primary)',
                                  padding: submitButton.styles?.paddingTop
                                    ? `${submitButton.styles.paddingTop} ${submitButton.styles.paddingRight || submitButton.styles.paddingTop} ${submitButton.styles.paddingBottom || submitButton.styles.paddingTop} ${submitButton.styles.paddingLeft || submitButton.styles.paddingTop}`
                                    : undefined,
                                  borderRadius: submitButton.styles?.borderRadius || '9999px',
                                  letterSpacing: submitButton.styles?.letterSpacing,
                                  textTransform: submitButton.styles?.textTransform,
                                }}
                              >
                                {submitButton.label}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </DroppableCanvas>
                  </CardContent>
                </Card>
              </div>

              {/* Field Settings / Global CSS Panel */}
              <div className="col-span-3 flex min-h-0 flex-col">
                <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                  <CardHeader className="flex-shrink-0 space-y-3">
                    <div className="flex rounded-md border border-border p-0.5 bg-muted/30">
                      <button
                        type="button"
                        onClick={() => setSettingsPanelMode('field')}
                        className={cn(
                          'flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors',
                          settingsPanelMode === 'field'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        )}
                      >
                        Field
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSettingsPanelMode('global')
                          setSelectedField(null)
                        }}
                        className={cn(
                          'flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors',
                          settingsPanelMode === 'global'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700'
                        )}
                      >
                        Form CSS
                      </button>
                    </div>
                    <div>
                      <CardTitle className="text-base">
                        {settingsPanelMode === 'global'
                          ? 'Form CSS'
                          : selectedFieldData
                            ? 'Field Settings'
                            : 'Properties'}
                      </CardTitle>
                      {settingsPanelMode === 'field' && selectedFieldData ? (
                        <p className="text-sm text-slate-500 capitalize mt-0.5">
                          {selectedFieldData.type} field
                        </p>
                      ) : settingsPanelMode === 'global' ? (
                        <p className="text-sm text-slate-500 mt-0.5">
                          Styles for this form only — not shared with other forms
                        </p>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent 
                    className="overflow-y-auto flex-1 pb-2 min-h-0"
                    style={{ overscrollBehavior: 'contain' }}
                  >
                    {settingsPanelMode === 'global' ? (
                      <GlobalStylePanel
                        styles={globalStyles}
                        excludeKeys={globalStyleExcludeKeys}
                        fields={[
                          ...formFields.filter(isCanvasField),
                          submitButton,
                        ]}
                        onStylesChange={setGlobalStyles}
                        onExcludeKeysChange={setGlobalStyleExcludeKeys}
                      />
                    ) : selectedFieldData ? (
                      <StylePanel
                        field={selectedFieldData}
                        onStyleChange={handleFieldUpdate}
                        onFieldUpdate={handleFieldUpdate}
                        onLeadReasonsRefresh={refreshLeadReasons}
                        leadReasons={leadReasons}
                        reasonsLocationID={resolveReasonsLocationID(formLocationID)}
                        reasonOptionsBaseline={reasonOptionsBaseline}
                        globalStyleExcludeKeys={globalStyleExcludeKeys}
                        onToggleGlobalExclude={(excludeKey, excluded) => {
                          setGlobalStyleExcludeKeys((prev) => {
                            if (excluded) {
                              return prev.includes(excludeKey) ? prev : [...prev, excludeKey]
                            }
                            return prev.filter((k) => k !== excludeKey)
                          })
                        }}
                      />
                    ) : (
                      <div className="text-center py-12 text-slate-400">
                        <div className="mb-3 text-4xl">⚙️</div>
                        <p className="text-sm">Select a field to edit</p>
                        <button
                          type="button"
                          className="mt-3 text-xs text-sky-700 hover:underline"
                          onClick={() => setSettingsPanelMode('global')}
                        >
                          Or edit this form&apos;s CSS
                        </button>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div className="mt-4 space-y-2 flex-shrink-0">
                  <Button variant="gradient" className="w-full" onClick={handlePreview}>
                    <Eye className="h-4 w-4 mr-2" />
                    Preview Form
                  </Button>
                  <Button variant="outline" className="w-full" onClick={exportAsHTML}>
                    <Download className="h-4 w-4 mr-2" />
                    Export as HTML
                  </Button>
                </div>

              </div>
            </div>

            <DragOverlay>
              {activeId ? (
                <div className="rounded-md border border-sky-200 bg-white px-3 py-2 shadow-xl">
                  {activeId.toString().startsWith('lead-prop-') ? (
                    (() => {
                      const prop = LEAD_PROPERTIES.find(
                        (p) => `lead-prop-${p.id}` === activeId.toString()
                      )
                      const IconComponent = prop?.icon
                      return (
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          {IconComponent ? <IconComponent className="h-4 w-4 text-slate-500" /> : null}
                          <span>{prop?.label}</span>
                        </div>
                      )
                    })()
                  ) : activeId.toString().startsWith('form-el-') ? (
                    (() => {
                      const element = FORM_ELEMENTS.find(
                        (e) => `form-el-${e.id}` === activeId.toString()
                      )
                      const IconComponent = element?.icon
                      return (
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          {IconComponent ? <IconComponent className="h-4 w-4 text-slate-500" /> : null}
                          <span>{element?.name}</span>
                        </div>
                      )
                    })()
                  ) : activeId.toString().startsWith('field-type-') ? (
                    (() => {
                      const fieldType = fieldTypes.find(
                        (ft) => `field-type-${ft.id}` === activeId.toString()
                      )
                      const IconComponent = fieldType?.icon
                      return (
                        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                          {IconComponent ? <IconComponent className="h-4 w-4 text-slate-500" /> : null}
                          <span>{fieldType?.name}</span>
                        </div>
                      )
                    })()
                  ) : (
                    <div className="text-sm font-medium text-slate-700">
                      {formFields.find((f) => f.id === activeId)?.label || 'Moving field...'}
                    </div>
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
          </div>
        )}

        {/* Analytics View */}
        {activeTab === 'analytics' && (
          <div className="space-y-6 relative">
          {gaViewsLoading ? (
            <div className="absolute inset-0 z-10 rounded-lg bg-background/70 backdrop-blur-[1px] flex items-center justify-center">
              <GlobalLoader text="Fetching analytics…" />
            </div>
          ) : null}
          {!gaViewsLoading && analyticsFormsLoading ? (
            <div className="absolute inset-0 z-10 rounded-lg bg-background/70 backdrop-blur-[1px] flex items-center justify-center">
              <GlobalLoader text="Loading templates…" />
            </div>
          ) : null}
          {(() => {
            // Dummy submissions + conversion rate (until real submission tracking exists)
            const baseViews = Number(gaViews?.last30Days) || 0
            const submissionRate = 0.12 // 12% dummy baseline
            const totalSubmissions = Math.max(0, Math.round(baseViews * submissionRate))
            const conversionRate = baseViews > 0 ? (totalSubmissions / baseViews) * 100 : 0
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Total form submissions</p>
                        <h3 className="text-3xl font-bold text-foreground tabular-nums">
                          {gaViewsLoading ? '—' : totalSubmissions}
                        </h3>
                      </div>
                      <div className="h-12 w-12 rounded-lg bg-brand-light flex items-center justify-center">
                        <FileText className="h-6 w-6 text-brand" />
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground mb-1">Conversion rate</p>
                        <h3 className="text-3xl font-bold text-foreground tabular-nums">
                          {gaViewsLoading ? '—' : `${conversionRate.toFixed(1)}%`}
                        </h3>
                      </div>
                      <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                        <BarChart3 className="h-6 w-6 text-muted-foreground" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          })()}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Total Views (all-time)</p>
                    <h3 className="text-3xl font-bold text-foreground">
                      {gaViewsLoading ? '—' : gaViews.allTime}
                    </h3>
                    {gaViewsError ? (
                      <p className="text-xs text-destructive mt-2">{gaViewsError}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-2">From Google Analytics</p>
                    )}
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-brand-light flex items-center justify-center">
                    <FileText className="h-6 w-6 text-brand" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Views (last 30 days)</p>
                    <h3 className="text-3xl font-bold text-foreground">
                      {gaViewsLoading ? '—' : gaViews.last30Days}
                    </h3>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center">
                    <BarChart3 className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Views (last 7 days)</p>
                    <h3 className="text-3xl font-bold text-foreground">
                      {gaViewsLoading ? '—' : gaViews.last7Days}
                    </h3>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-purple-100 flex items-center justify-center">
                    <BarChart3 className="h-6 w-6 text-purple-600" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Active Users (all-time)</p>
                    <h3 className="text-3xl font-bold text-foreground">
                      {gaViewsLoading ? '—' : gaActiveUsers.allTime}
                    </h3>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                    <BarChart3 className="h-6 w-6 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Active Users (last 30 days)</p>
                    <h3 className="text-3xl font-bold text-foreground">
                      {gaViewsLoading ? '—' : gaActiveUsers.last30Days}
                    </h3>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                    <BarChart3 className="h-6 w-6 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Active Users (last 7 days)</p>
                    <h3 className="text-3xl font-bold text-foreground">
                      {gaViewsLoading ? '—' : gaActiveUsers.last7Days}
                    </h3>
                  </div>
                  <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center">
                    <BarChart3 className="h-6 w-6 text-muted-foreground" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-base">Demographics</CardTitle>
                  <CardDescription>Active users distribution</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={gaDemographicsRange === 'allTime' ? 'default' : 'outline'}
                    onClick={() => setGaDemographicsRange('allTime')}
                    disabled={gaViewsLoading}
                  >
                    All time
                  </Button>
                  <Button
                    size="sm"
                    variant={gaDemographicsRange === 'last30Days' ? 'default' : 'outline'}
                    onClick={() => setGaDemographicsRange('last30Days')}
                    disabled={gaViewsLoading}
                  >
                    Last 30 days
                  </Button>
                  <Button
                    size="sm"
                    variant={gaDemographicsRange === 'last7Days' ? 'default' : 'outline'}
                    onClick={() => setGaDemographicsRange('last7Days')}
                    disabled={gaViewsLoading}
                  >
                    Last 7 days
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {(() => {
                const mkItems = (raw, key) => {
                  const rows = Array.isArray(raw) ? raw : []
                  const filtered = rows.filter((x) => x && (Number(x.activeUsers) || 0) > 0)
                  const top = filtered
                    .slice(0, 5)
                    .map((x) => ({ label: x?.[key] || '(not set)', value: Number(x.activeUsers) || 0 }))
                  const otherValue = filtered.slice(5).reduce((sum, x) => sum + (Number(x?.activeUsers) || 0), 0)
                  return otherValue > 0 ? [...top, { label: 'Other', value: otherValue }] : top
                }

                const countryItems = mkItems(gaDemographics?.countries?.[gaDemographicsRange], 'country')
                const regionItems = mkItems(gaDemographics?.regions?.[gaDemographicsRange], 'region')
                const cityItems = mkItems(gaDemographics?.cities?.[gaDemographicsRange], 'city')

                const charts = [
                  { title: 'Country', items: countryItems, aria: 'Active users by country' },
                  { title: 'Region', items: regionItems, aria: 'Active users by region' },
                  { title: 'Town/City', items: cityItems, aria: 'Active users by city' },
                ]

                return (
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {charts.map((c, cIdx) => {
                      const { total, segments } = makePieSegments(c.items)
                      if (!segments.length) {
                        return (
                          <div key={c.title} className="rounded-lg border border-border bg-card p-4">
                            <div className="text-sm font-semibold text-foreground">{c.title}</div>
                            <div className="text-sm text-muted-foreground py-8">No data yet.</div>
                          </div>
                        )
                      }

                      return (
                        <div key={c.title} className="rounded-lg border border-border bg-card p-4">
                          <div className="text-sm font-semibold text-foreground mb-3">{c.title}</div>
                          <div className="flex items-start gap-4">
                            <svg width="200" height="200" viewBox="0 0 220 220" role="img" aria-label={c.aria}>
                              <defs>
                                <filter id={`pieShadow-${cIdx}`} x="-20%" y="-20%" width="140%" height="140%">
                                  <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="rgba(15, 23, 42, 0.12)" />
                                </filter>
                              </defs>
                              <circle cx="110" cy="110" r="92" fill="hsl(var(--muted))" />
                              {segments.length === 1 ? (
                                <circle
                                  cx="110"
                                  cy="110"
                                  r="90"
                                  fill={segments[0].color}
                                  filter={`url(#pieShadow-${cIdx})`}
                                  stroke="hsl(var(--card))"
                                  strokeWidth="2"
                                />
                              ) : (
                                segments.map((s, idx) => (
                                  <path
                                    key={idx}
                                    d={describeArc(110, 110, 90, s.startFrac, s.endFrac)}
                                    fill={s.color}
                                    filter={`url(#pieShadow-${cIdx})`}
                                    stroke="hsl(var(--card))"
                                    strokeWidth="2"
                                  />
                                ))
                              )}
                              {segments.map((s, idx) => {
                                const pct = total ? (s.value / total) * 100 : 0
                                if (pct < 4) return null
                                const { x, y } = segmentLabelPosition(110, 110, 62, s.startFrac, s.endFrac)
                                return (
                                  <text
                                    key={`t-${idx}`}
                                    x={x}
                                    y={y}
                                    textAnchor="middle"
                                    dominantBaseline="middle"
                                    fill={segments.length === 1 ? 'hsl(var(--primary-foreground))' : 'white'}
                                    fontSize="14"
                                    fontWeight="700"
                                  >
                                    {Math.round(pct)}%
                                  </text>
                                )
                              })}
                            </svg>

                            <div className="flex-1 space-y-2 pt-1">
                              {segments.map((s, idx) => (
                                <div key={idx} className="flex items-center justify-between gap-3 text-sm">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                                    <span className="truncate text-muted-foreground">{s.label}</span>
                                  </div>
                                  <div className="shrink-0 tabular-nums text-foreground font-medium">{s.value}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Pages and screens</CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          disabled={gaViewsLoading}
                          className="h-7 w-7 border-border bg-muted/50 hover:bg-muted text-muted-foreground shadow-sm"
                          title="Change pages dimension"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[260px]">
                        <DropdownMenuItem
                          onClick={() => setGaPagesDimension('pagePath')}
                          className={gaPagesDimension === 'pagePath' ? 'bg-accent text-accent-foreground' : ''}
                        >
                          Page path + screen class
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => setGaPagesDimension('pageTitle')}
                          className={gaPagesDimension === 'pageTitle' ? 'bg-accent text-accent-foreground' : ''}
                        >
                          Page title + screen class
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <CardDescription>
                    {gaPagesDimension === 'pageTitle' ? 'Page title and screen class' : 'Page path and screen class'}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={gaPagesRange === 'allTime' ? 'default' : 'outline'}
                    onClick={() => setGaPagesRange('allTime')}
                    disabled={gaViewsLoading}
                  >
                    All time
                  </Button>
                  <Button
                    size="sm"
                    variant={gaPagesRange === 'last30Days' ? 'default' : 'outline'}
                    onClick={() => setGaPagesRange('last30Days')}
                    disabled={gaViewsLoading}
                  >
                    Last 30 days
                  </Button>
                  <Button
                    size="sm"
                    variant={gaPagesRange === 'last7Days' ? 'default' : 'outline'}
                    onClick={() => setGaPagesRange('last7Days')}
                    disabled={gaViewsLoading}
                  >
                    Last 7 days
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="overflow-auto rounded-md border border-border">
                <table className="min-w-[720px] w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">
                        {gaPagesDimension === 'pageTitle' ? 'Page title' : 'Page path'}
                      </th>
                      <th className="px-4 py-3 font-medium text-right">Views</th>
                      <th className="px-4 py-3 font-medium text-right">Active users</th>
                      <th className="px-4 py-3 font-medium text-right">Views / active user</th>
                      <th className="px-4 py-3 font-medium text-right">Avg engagement / active user</th>
                    </tr>
                  </thead>
                  <tbody className="bg-card">
                    {(gaPages?.[gaPagesRange] || []).length === 0 ? (
                      <tr>
                        <td className="px-4 py-6 text-muted-foreground" colSpan={5}>
                          No data yet.
                        </td>
                      </tr>
                    ) : (
                      (gaPages?.[gaPagesRange] || []).map((row, idx) => (
                        <tr key={`${row?.value || 'row'}-${idx}`} className="border-t border-border">
                          <td className="px-4 py-3 font-mono text-xs text-foreground">
                            {row?.value || '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">
                            {Number(row?.views) || 0}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">
                            {Number(row?.activeUsers) || 0}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">
                            {Number(row?.viewsPerActiveUser) ? Number(row.viewsPerActiveUser).toFixed(2) : '0.00'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-foreground">
                            {formatDuration(row?.avgEngagementTimePerActiveUser)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <CardTitle className="text-base">Templates</CardTitle>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              {analyticsFormsError ? (
                <div className="text-sm text-destructive">{analyticsFormsError}</div>
              ) : (
                (() => {
                  const list = Array.isArray(analyticsForms) ? analyticsForms : []
                  // Some backends mark templates explicitly; fall back to showing whatever the API returns.
                  const hasTemplateFlag = list.some((f) => typeof f?.isTemplate === 'boolean' || typeof f?.template === 'boolean')
                  const rows = hasTemplateFlag ? list.filter((f) => f?.isTemplate || f?.template) : list
                  if (!rows.length) return <div className="text-sm text-muted-foreground py-4">No forms found.</div>
                  return (
                    <div className="overflow-auto rounded-md border border-border">
                      <table className="min-w-[720px] w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr className="text-left text-muted-foreground">
                            <th className="px-4 py-3 font-medium">View</th>
                            <th className="px-4 py-3 font-medium">Form</th>
                            <th className="px-4 py-3 font-medium">Template</th>
                            <th className="px-4 py-3 font-medium">Status</th>
                            <th className="px-4 py-3 font-medium">Updated</th>
                          </tr>
                        </thead>
                        <tbody className="bg-card">
                          {rows.map((f) => (
                            <tr key={f._id} className="border-t border-border">
                              <td className="px-4 py-3">
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8"
                                  title="View template analytics"
                                  onClick={() => router.push(`/forms/template-analytics/${f._id}`)}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </td>
                              <td className="px-4 py-3 text-foreground font-medium">{f?.name || 'Untitled'}</td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {typeof f?.isTemplate === 'boolean' ? (f.isTemplate ? 'Yes' : 'No') : (f?.fromTemplate ? 'From template' : '—')}
                              </td>
                              <td className="px-4 py-3 text-muted-foreground">{f?.status || '—'}</td>
                              <td className="px-4 py-3 text-muted-foreground">
                                {f?.updatedAt ? formatDate(f.updatedAt) : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()
              )}
            </CardContent>
          </Card>

          </div>
        )}
      </div>

      {/* Preview Modal */}
      <Dialog open={showPreview} onClose={() => setShowPreview(false)} maxWidth="2xl">
        <DialogContent onClose={() => setShowPreview(false)} className="max-h-[90vh] overflow-y-auto border-2 border-slate-200 shadow-2xl bg-[#f8fafc] p-8">
          <DialogHeader className="border-b border-slate-200 pb-4 mb-6 bg-white rounded-t-lg -m-6 px-6 pt-6">
            <DialogTitle className="text-xl font-bold text-slate-900">Form Preview</DialogTitle>
            <p className="text-sm text-slate-500 mt-1">See how your form will look to users</p>
          </DialogHeader>
          <div className="mt-4">
            {formFields.length === 0 ? (
              <div className="text-center py-12 text-slate-400 border-2 border-dashed border-slate-300 rounded-lg bg-white">
                <FileText className="h-16 w-16 mx-auto mb-4 text-slate-300" />
                <p className="text-slate-500">No fields to preview. Add fields to your form first.</p>
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm border border-slate-200" style={{ maxWidth: '600px', margin: '0 auto', overflow: 'hidden' }}>
                <iframe
                  title="Form Preview"
                  sandbox="allow-scripts allow-forms allow-same-origin allow-modals"
                  allow="autoplay; speaker-selection"
                  srcDoc={generateExportedHTML()}
                  style={{ width: '100%', height: '620px', border: 0, display: 'block' }}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Export Modal — HubSpot-style Embed code / Share link */}
      <Dialog open={showExport} onClose={() => setShowExport(false)} maxWidth="2xl">
        <DialogContent onClose={() => setShowExport(false)} className="max-h-[90vh] overflow-hidden flex flex-col border-2 border-slate-200 shadow-2xl bg-white">
          <DialogHeader className="border-b border-slate-200 pb-4 mb-4 flex-shrink-0">
            <DialogTitle className="text-xl font-bold text-slate-900">Embed your form</DialogTitle>
            <p className="text-sm text-slate-500 mt-1">
              Copy a short embed snippet or share a public link
            </p>
          </DialogHeader>

          {(embedCode || shareLink) && (
            <div className="mb-4 flex gap-1 border-b border-border flex-shrink-0">
              <button
                type="button"
                onClick={() => setExportTab('embed')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  exportTab === 'embed'
                    ? 'border-[var(--studio-primary)] text-[var(--studio-primary)]'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Code2 className="h-3.5 w-3.5" />
                Embed code
              </button>
              <button
                type="button"
                onClick={() => setExportTab('share')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  exportTab === 'share'
                    ? 'border-[var(--studio-primary)] text-[var(--studio-primary)]'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <Link2 className="h-3.5 w-3.5" />
                Share link
              </button>
              <button
                type="button"
                onClick={() => setExportTab('html')}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  exportTab === 'html'
                    ? 'border-[var(--studio-primary)] text-[var(--studio-primary)]'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                Full HTML
              </button>
            </div>
          )}

          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            {exportTab === 'embed' && embedCode ? (
              <>
                <p className="text-[13px] text-muted-foreground mb-3 flex-shrink-0">
                  Paste this into your website. The form keeps its original look until you add your own{' '}
                  <code className="text-xs bg-muted px-1 rounded">&lt;style&gt;</code> block.
                  A CSS selector guide is in the comment above the scripts (comments do not change styles).
                </p>
                <div className="bg-slate-900 rounded-lg p-4 overflow-auto flex-1 min-h-0 border border-slate-700">
                  <pre className="text-sm text-slate-100 font-mono whitespace-pre-wrap break-words">
                    <code>{embedCode}</code>
                  </pre>
                </div>
                <a
                  href="/marketing/form-builder/embed-preview"
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault()
                    openEmbedPreview()
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--studio-primary)] hover:underline flex-shrink-0"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open test webpage to preview this embed
                </a>
              </>
            ) : exportTab === 'share' && shareLink ? (
              <>
                <p className="text-[13px] text-muted-foreground mb-3 flex-shrink-0">
                  Anyone with this link can open the hosted form (like HubSpot share links).
                </p>
                <div className="rounded-lg border border-border bg-muted/30 px-4 py-4 flex-1 min-h-0">
                  <a
                    href={shareLink}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[14px] font-medium text-[var(--studio-primary)] break-all hover:underline inline-flex items-start gap-2"
                  >
                    <ExternalLink className="h-4 w-4 mt-0.5 shrink-0" />
                    {shareLink}
                  </a>
                </div>
              </>
            ) : (
              <>
                <p className="text-[13px] text-muted-foreground mb-3 flex-shrink-0">
                  Full standalone HTML document (longer). Prefer Embed code for websites.
                </p>
                <div className="bg-slate-900 rounded-lg p-4 overflow-auto flex-1 min-h-0 border border-slate-700">
                  <pre className="text-sm text-slate-100 font-mono whitespace-pre-wrap break-words">
                    <code>{exportedHTML}</code>
                  </pre>
                </div>
              </>
            )}

            <div className="flex items-center gap-3 mt-4 pt-4 border-t border-slate-200 flex-shrink-0">
              <Button variant="outline" className="flex-1" onClick={copyToClipboard}>
                <Copy className="h-4 w-4 mr-2" />
                Copy
              </Button>
              {exportTab === 'embed' && embedCode ? (
                <Button variant="gradient" className="flex-1" onClick={openEmbedPreview}>
                  <Eye className="h-4 w-4 mr-2" />
                  Test preview
                </Button>
              ) : exportTab === 'share' && shareLink ? (
                <Button
                  variant="gradient"
                  className="flex-1"
                  onClick={() => window.open(shareLink, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open link
                </Button>
              ) : (
                <Button variant="gradient" className="flex-1" onClick={downloadHTML}>
                  <Download className="h-4 w-4 mr-2" />
                  Download HTML
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Form Preview Modal */}
      {previewForm && (
        <Dialog open={!!previewForm} onClose={() => setPreviewForm(null)} maxWidth="2xl">
          <DialogContent onClose={() => setPreviewForm(null)} className="max-h-[90vh] overflow-hidden flex flex-col">
            <DialogHeader className="border-b border-border pb-3 flex-shrink-0">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-semibold">{previewForm.name}</DialogTitle>
                <button type="button" onClick={() => setPreviewForm(null)} className="h-7 w-7 flex items-center justify-center rounded-full hover:bg-muted transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </DialogHeader>
            <div className="flex-1 overflow-hidden min-h-0">
              {previewLoading ? (
                <div className="flex items-center justify-center py-16">
                  <GlobalLoader variant="inline" size="md" />
                </div>
              ) : previewForm.htmlCode ? (
                <iframe
                  srcDoc={previewForm.htmlCode}
                  className="w-full h-full min-h-[500px] border-0 rounded-lg"
                  title="Form preview"
                  sandbox="allow-forms allow-scripts"
                />
              ) : (
                <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                  No preview available for this form.
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </MainLayout>
  )
}

export default function FormsPage() {
  return (
    <Suspense
      fallback={
        <MainLayout title="Form Builder" subtitle="Create and manage forms">
          <div className="flex items-center justify-center py-20">
            <GlobalLoader variant="inline" size="md" />
          </div>
        </MainLayout>
      }
    >
      <FormsPageInner />
    </Suspense>
  )
}
