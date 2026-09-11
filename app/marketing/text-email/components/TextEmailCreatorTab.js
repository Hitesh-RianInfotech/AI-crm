'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Send } from 'lucide-react'
import { TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import LocationSelector, { ALL_BRANCHES_VALUE } from '@/components/shared/LocationSelector'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import { useToast } from '@/components/ui/toast'
import api from '@/lib/api'
import { getEffectiveBranch } from '@/lib/auth'
import { plainTextToHtml } from '@/lib/emailSend'
import {
  ADMIN_TEMPLATE_VARIABLES,
  STUDIO_TEMPLATE_VARIABLES,
} from '@/lib/template-scope'
import {
  extractCategoriesList,
  getTemplateCategoryId,
} from '@/app/marketing/email-builder/emailBuilderApi'

const EMAIL_TEXT_VARIABLES = [
  { name: '{{name}}', description: 'Contact name' },
  { name: '{{first_name}}', description: 'Contact first name' },
  { name: '{{email}}', description: 'Contact email' },
  ...STUDIO_TEMPLATE_VARIABLES,
  ...ADMIN_TEMPLATE_VARIABLES,
]

function defaultStudioIds() {
  const branch = getEffectiveBranch()
  return branch ? [String(branch)] : []
}

function previewText(message = '') {
  return String(message || '')
    .replaceAll('{{name}}', 'John Doe')
    .replaceAll('{{first_name}}', 'John')
    .replaceAll('{{email}}', 'john@example.com')
    .replaceAll('{{studio_name}}', 'Acme Studio')
    .replaceAll('{{studio_phone}}', '(555) 010-1234')
    .replaceAll('{{studio_email}}', 'hello@acmestudio.com')
    .replaceAll('{{studio_website}}', 'www.acmestudio.com')
    .replaceAll('{{studio_address}}', '123 Main St')
    .replaceAll('{{studio_city}}', 'Stamford')
    .replaceAll('{{studio_state}}', 'CT')
    .replaceAll('{{studio_zip}}', '06901')
    .replaceAll('{{admin_name}}', 'Jane Admin')
    .replaceAll('{{admin_first_name}}', 'Jane')
    .replaceAll('{{admin_last_name}}', 'Admin')
}

export default function TextEmailCreatorTab({
  initialTemplate,
  onCreated,
  onBack,
  dataVersion = 0,
}) {
  const toast = useToast()
  const editingId = initialTemplate?._id || null

  const [categories, setCategories] = useState([])
  const [loadingCats, setLoadingCats] = useState(false)

  const [subject, setSubject] = useState(initialTemplate?.subject || '')
  const [categoryId, setCategoryId] = useState(getTemplateCategoryId(initialTemplate) || '')
  const [locationID, setLocationID] = useState(
    initialTemplate?.allLocations
      ? ALL_BRANCHES_VALUE
      : Array.isArray(initialTemplate?.locationID)
        ? initialTemplate.locationID.map((l) => l?._id || l).filter(Boolean)
        : initialTemplate?.locationID?._id || initialTemplate?.locationID
          ? [initialTemplate.locationID?._id || initialTemplate.locationID]
          : defaultStudioIds()
  )
  const [body, setBody] = useState(initialTemplate?.body || '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!initialTemplate) {
      setSubject('')
      setCategoryId('')
      setLocationID(defaultStudioIds())
      setBody('')
      return
    }
    setSubject(initialTemplate.subject || '')
    setCategoryId(getTemplateCategoryId(initialTemplate) || '')
    setLocationID(
      initialTemplate.allLocations
        ? ALL_BRANCHES_VALUE
        : Array.isArray(initialTemplate.locationID)
          ? initialTemplate.locationID.map((l) => l?._id || l).filter(Boolean)
          : initialTemplate.locationID?._id || initialTemplate.locationID
            ? [initialTemplate.locationID?._id || initialTemplate.locationID]
            : defaultStudioIds()
    )
    setBody(String(initialTemplate.body || ''))
  }, [initialTemplate])

  const fetchCategories = useCallback(async () => {
    setLoadingCats(true)
    try {
      const result = await api.get('/api/email/builder/category')
      if (result.success) setCategories(extractCategoriesList(result))
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingCats(false)
    }
  }, [])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories, dataVersion])

  const locationScopedCategories = useMemo(() => {
    if (!locationID || (locationID !== ALL_BRANCHES_VALUE && (!Array.isArray(locationID) || locationID.length === 0))) {
      return categories
    }
    if (locationID === ALL_BRANCHES_VALUE) return categories
    return categories.filter((cat) => {
      if (cat.allLocations) return true
      const catLocs = (Array.isArray(cat.locationID) ? cat.locationID : cat.locationID ? [cat.locationID] : [])
        .map((l) => String(l?._id || l))
      return locationID.every((id) => catLocs.includes(String(id)))
    })
  }, [categories, locationID])

  useEffect(() => {
    if (!locationScopedCategories.length) {
      setCategoryId('')
      return
    }
    setCategoryId((prev) =>
      locationScopedCategories.some((c) => String(c._id) === String(prev))
        ? prev
        : locationScopedCategories[0]._id
    )
  }, [locationScopedCategories])

  const insertVariable = (v) => setBody((m) => `${m || ''}${v}`)

  const canSave =
    !!subject.trim() &&
    !!body.trim() &&
    !!categoryId &&
    !!(locationID === ALL_BRANCHES_VALUE || (Array.isArray(locationID) && locationID.length > 0))

  const saveTemplate = async () => {
    if (!(locationID === ALL_BRANCHES_VALUE || (Array.isArray(locationID) && locationID.length > 0))) {
      toast.error({ title: 'Missing location', message: 'Select one or more studios, or All branches.' })
      return
    }
    if (!canSave) return
    setSaving(true)
    try {
      const plain = String(body || '').trim()
      const allLocations = locationID === ALL_BRANCHES_VALUE
      const payload = {
        categoryID: categoryId,
        subject: subject.trim(),
        body: plain,
        htmlBody: plainTextToHtml(plain),
        format: 'text',
        allLocations,
        locationID: allLocations ? [] : locationID,
      }

      const result = editingId
        ? await api.patch(`/api/email/builder/${editingId}`, payload)
        : await api.post('/api/email/builder/', payload)

      if (!result.success) {
        toast.error({
          title: editingId ? 'Update failed' : 'Create failed',
          message: result.error || 'Could not save text email.',
        })
        return
      }
      toast.success({
        title: editingId ? 'Updated' : 'Created',
        message: editingId ? 'Text email updated.' : 'Text email template created.',
      })
      if (!editingId) {
        setSubject('')
        setBody('')
      }
      onCreated?.(result.data)
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not save text email.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <TabsContent value="creator" className="space-y-6 mt-6">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to templates
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-6">
        <div className="md:col-span-4 lg:col-span-3">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-sm">Variables</CardTitle>
            </CardHeader>
            <CardContent className="p-3 space-y-3">
              <p className="text-xs text-muted-foreground px-1">
                Insert into the message. Studio and admin tags resolve when the email is sent.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-2">
                {EMAIL_TEXT_VARIABLES.map((variable) => (
                  <button
                    key={variable.name}
                    onClick={() => insertVariable(variable.name)}
                    className="w-full text-left p-2 rounded-lg hover:bg-accent transition-colors"
                    type="button"
                  >
                    <p className="text-xs sm:text-sm font-mono font-medium">{variable.name}</p>
                    <p className="text-xs text-muted-foreground">{variable.description}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-8 lg:col-span-5">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">
                {editingId ? 'Edit text email' : 'Text email editor'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Email body</Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={12}
                  placeholder="Type your plain-text email…"
                />
                <p className="text-xs text-muted-foreground">
                  {String(body || '').length.toLocaleString()} characters
                </p>
              </div>

              <div className="p-4 bg-brand/10 border border-brand-light rounded-lg text-sm">
                <p className="font-medium text-brand-dark mb-2">Preview:</p>
                <p className="text-brand-dark whitespace-pre-wrap">{previewText(body) || '—'}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-12 lg:col-span-4">
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-sm">Template settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Studio location *</Label>
                <LocationSelector
                  value={locationID}
                  onChange={setLocationID}
                  multiple
                  allowAllBranches
                  showAllOption={false}
                  placeholder="Select studio(s)…"
                />
              </div>

              <div className="space-y-2">
                <Label>Subject</Label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Class reminder"
                />
              </div>

              <div className="space-y-2">
                <Label>Category</Label>
                {loadingCats ? (
                  <div className="py-2">
                    <LoadingSpinner size="sm" text="Loading categories…" />
                  </div>
                ) : (
                  <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                    <option value="">Select category</option>
                    {locationScopedCategories.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  Uses the same categories as Email Builder.
                </p>
              </div>

              <Button variant="gradient" className="w-full" onClick={saveTemplate} disabled={saving || !canSave}>
                <Send className="h-4 w-4 mr-2" />
                {saving ? 'Saving…' : editingId ? 'Update template' : 'Save template'}
              </Button>

              {!canSave && (
                <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Required:</p>
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {!(locationID === ALL_BRANCHES_VALUE || (Array.isArray(locationID) && locationID.length > 0)) && (
                      <li>Studio location</li>
                    )}
                    {!subject.trim() && <li>Subject</li>}
                    {!categoryId && <li>Category</li>}
                    {!body.trim() && <li>Email body</li>}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </TabsContent>
  )
}
