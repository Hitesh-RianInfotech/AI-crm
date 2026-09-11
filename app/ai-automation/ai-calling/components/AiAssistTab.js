'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { TabsContent } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SearchInput from '@/components/ui/search-input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast, toast as toastApi } from '@/components/ui/toast'
import LoadingSpinner from '@/components/shared/LoadingSpinner'
import GlobalLoader from '@/components/shared/GlobalLoader'
import LocationSelector from '@/components/shared/LocationSelector'
import api, { getApiBaseUrl } from '@/lib/api'
import {
  DEFAULT_VAPI_ELEVENLABS_TTS_MODEL_ID,
  VAPI_ELEVENLABS_VOICE_DEFAULTS,
  VAPI_ELEVENLABS_VOICE_MODEL_OPTIONS,
  VAPI_ELEVENLABS_SPEED_MAX,
  VAPI_ELEVENLABS_SPEED_MIN,
  VAPI_LLM_OPTIONS,
  clampVapiElevenLabsSpeedForUi,
  clampVapiLlmTemperature,
  VAPI_SUCCESS_EVALUATION_RUBRICS,
  DEFAULT_SUCCESS_EVALUATION_RUBRIC,
  DEFAULT_SUCCESS_EVALUATION_PROMPT,
} from '@/lib/vapiVoice'
import {
  BUILTIN_BACKGROUND_SOUNDS,
  formatBackgroundSoundLabel,
  getSelectableBackgroundSounds,
  isVapiCallableBackgroundSoundUrl,
  normalizeBackgroundSoundSelection,
  resolveBackgroundSoundForSave,
  resolveBackgroundSoundOptionValue,
} from '@/lib/backgroundSound'
import { hasLocationSelection, initLocationID, locationBadgeLabel, toLocationPayload } from './locationScope'

const ASSISTANTS_PAGE_SIZE = 9
const DEFAULT_LLM = 'gpt-4o-mini'
const DEFAULT_TEMPERATURE = 0.65
const DEFAULT_ASSISTANT_OPTIONS = {
  firstMessageMode: 'assistant-speaks-first-with-model-generated-message',
  firstMessage: 'Hello.',
  voiceMessage: 'Hey, I tried calling you!',
  backgroundSound: 'office',
  endCallMessage: 'Goodbye.',
}

// Returns the first non-empty file ID from whichever field the backend sent.
function normalizeFileId(fileID, fileIDies) {
  if (Array.isArray(fileIDies) && fileIDies.length && fileIDies[0]) return String(fileIDies[0])
  if (Array.isArray(fileID) && fileID.length && fileID[0]) return String(fileID[0])
  if (fileIDies && !Array.isArray(fileIDies)) return String(fileIDies)
  if (fileID && !Array.isArray(fileID)) return String(fileID)
  return ''
}

function extractAssistantsPayload(result) {
  const payload = result?.data
  const list = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.data?.data)
    ? payload.data.data
    : Array.isArray(payload)
    ? payload
    : []
  const pagination = payload?.pagination || payload?.data?.pagination || result?.pagination
  return {
    list: Array.isArray(list) ? list : [],
    total: pagination?.total ?? (Array.isArray(list) ? list.length : 0),
  }
}

export default function AiAssistTab() {
  const toast = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [assistants, setAssistants] = useState([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [deletingId, setDeletingId] = useState(null)

  // --- editor state ---
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingAssistant, setEditingAssistant] = useState(null)
  const [editorLoading, setEditorLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [personas, setPersonas] = useState([])
  const [scripts, setScripts] = useState([])
  const [knowledgeFiles, setKnowledgeFiles] = useState([])
  const [backgroundSounds, setBackgroundSounds] = useState([])
  const [optionsLoading, setOptionsLoading] = useState(false)

  const [name, setName] = useState('')
  const [selectedPersonaId, setSelectedPersonaId] = useState('')
  const [selectedScriptId, setSelectedScriptId] = useState('')
  const [selectedKnowledgeFileId, setSelectedKnowledgeFileId] = useState('')
  const [firstMessageMode, setFirstMessageMode] = useState(DEFAULT_ASSISTANT_OPTIONS.firstMessageMode)
  const [firstMessage, setFirstMessage] = useState(DEFAULT_ASSISTANT_OPTIONS.firstMessage)
  const [voiceMessage, setVoiceMessage] = useState(DEFAULT_ASSISTANT_OPTIONS.voiceMessage)
  const [backgroundSound, setBackgroundSound] = useState('')
  const [endCallMessage, setEndCallMessage] = useState(DEFAULT_ASSISTANT_OPTIONS.endCallMessage)
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM)
  const [temperature, setTemperature] = useState(DEFAULT_TEMPERATURE)
  const [ttsModelId, setTtsModelId] = useState(DEFAULT_VAPI_ELEVENLABS_TTS_MODEL_ID)
  const [ttsStability, setTtsStability] = useState(VAPI_ELEVENLABS_VOICE_DEFAULTS.stability)
  const [ttsSimilarity, setTtsSimilarity] = useState(VAPI_ELEVENLABS_VOICE_DEFAULTS.similarityBoost)
  const [ttsSpeed, setTtsSpeed] = useState(VAPI_ELEVENLABS_VOICE_DEFAULTS.speed)
  const [ttsStyle, setTtsStyle] = useState(VAPI_ELEVENLABS_VOICE_DEFAULTS.style)
  const [ttsSpeakerBoost, setTtsSpeakerBoost] = useState(true)
  const [successEvaluationEnabled, setSuccessEvaluationEnabled] = useState(true)
  const [successEvaluationPrompt, setSuccessEvaluationPrompt] = useState(DEFAULT_SUCCESS_EVALUATION_PROMPT)
  const [successEvaluationRubric, setSuccessEvaluationRubric] = useState(DEFAULT_SUCCESS_EVALUATION_RUBRIC)
  const [locationID, setLocationID] = useState([])

  // --- preview state ---
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewData, setPreviewData] = useState(null)
  const [previewKnowledgeNames, setPreviewKnowledgeNames] = useState([])

  // ── search debounce ──
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

  useEffect(() => { setPage(1) }, [debouncedSearch])

  // ── derived selected items ──
  const llmSelectOptions = useMemo(() => {
    const base = VAPI_LLM_OPTIONS
    const has = base.some((o) => o.value === llmModel)
    if (llmModel && !has) {
      return [{ value: llmModel, label: `${llmModel} (saved)` }, ...base]
    }
    return base
  }, [llmModel])

  const selectedPersona = useMemo(
    () => personas.find((p) => p._id === selectedPersonaId) || null,
    [personas, selectedPersonaId]
  )
  const selectedScript = useMemo(
    () => scripts.find((s) => s._id === selectedScriptId) || null,
    [scripts, selectedScriptId]
  )
  const selectedKnowledgeFile = useMemo(
    () =>
      knowledgeFiles.find(
        (f) => String(f.fileID || '') === selectedKnowledgeFileId || f._id === selectedKnowledgeFileId
      ) || null,
    [knowledgeFiles, selectedKnowledgeFileId]
  )

  const canSave = !!name.trim() && !!selectedPersona && !!selectedScript && hasLocationSelection(locationID)
  const selectableBackgroundSounds = useMemo(
    () => getSelectableBackgroundSounds(backgroundSounds, getApiBaseUrl()),
    [backgroundSounds]
  )

  // ── fetch assistants list ──
  const fetchAssistants = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(ASSISTANTS_PAGE_SIZE),
      })
      if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())

      const result = await api.get(`/api/ai-assistant/paginated?${params.toString()}`)
      if (!result.success) {
        setError(result.error || 'Failed to fetch assistants')
        return
      }
      const { list, total } = extractAssistantsPayload(result)
      setAssistants(list)
      setTotalCount(total)
      setTotalPages(Math.max(1, Math.ceil((total || 0) / ASSISTANTS_PAGE_SIZE)))
    } catch (e) {
      console.error(e)
      setError('Failed to fetch assistants')
    } finally {
      setLoading(false)
    }
  }, [page, debouncedSearch])

  useEffect(() => { fetchAssistants() }, [fetchAssistants])

  // ── fetch form options — returns fetched lists so callers can use them immediately ──
  const fetchFormOptions = useCallback(async () => {
    setOptionsLoading(true)
    try {
      const [personaRes, scriptRes, fileRes, soundRes] = await Promise.all([
        api.get('/api/ai-persona?page=1&limit=100'),
        api.get('/api/ai-script/'),
        api.get('/api/ai-script/file/'),
        api.get('/api/ai-background-sound/'),
      ])

      const personaList = Array.isArray(personaRes?.data)
        ? personaRes.data
        : personaRes?.data?.personas || []
      const scriptList = scriptRes?.data?.Scripts || []
      const fileList = fileRes?.data?.files || []
      const soundList = soundRes?.data?.sounds || soundRes?.data || []

      const p = Array.isArray(personaList) ? personaList : []
      const s = Array.isArray(scriptList) ? scriptList : []
      const f = Array.isArray(fileList) ? fileList : []
      const bg = Array.isArray(soundList) ? soundList : []

      setPersonas(p)
      setScripts(s)
      setKnowledgeFiles(f)
      setBackgroundSounds(bg)

      return { personas: p, scripts: s, knowledgeFiles: f, backgroundSounds: bg }
    } catch (e) {
      console.error(e)
      toastApi.error('Error', { description: 'Could not load persona/script/knowledge data.' })
      return { personas: [], scripts: [], knowledgeFiles: [], backgroundSounds: [] }
    } finally {
      setOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchFormOptions()
  }, [fetchFormOptions])

  // ── reset editor form ──
  const resetEditorState = () => {
    setEditingAssistant(null)
    setName('')
    setSelectedPersonaId('')
    setSelectedScriptId('')
    setSelectedKnowledgeFileId('')
    setFirstMessageMode(DEFAULT_ASSISTANT_OPTIONS.firstMessageMode)
    setFirstMessage(DEFAULT_ASSISTANT_OPTIONS.firstMessage)
    setVoiceMessage(DEFAULT_ASSISTANT_OPTIONS.voiceMessage)
    setBackgroundSound('')
    setEndCallMessage(DEFAULT_ASSISTANT_OPTIONS.endCallMessage)
    setLlmModel(DEFAULT_LLM)
    setTemperature(DEFAULT_TEMPERATURE)
    setTtsModelId(DEFAULT_VAPI_ELEVENLABS_TTS_MODEL_ID)
    setTtsStability(VAPI_ELEVENLABS_VOICE_DEFAULTS.stability)
    setTtsSimilarity(VAPI_ELEVENLABS_VOICE_DEFAULTS.similarityBoost)
    setTtsSpeed(VAPI_ELEVENLABS_VOICE_DEFAULTS.speed)
    setTtsStyle(VAPI_ELEVENLABS_VOICE_DEFAULTS.style)
    setTtsSpeakerBoost(true)
    setSuccessEvaluationEnabled(true)
    setSuccessEvaluationPrompt(DEFAULT_SUCCESS_EVALUATION_PROMPT)
    setSuccessEvaluationRubric(DEFAULT_SUCCESS_EVALUATION_RUBRIC)
    setLocationID(initLocationID(null))
  }

  const syncVoiceTuningFromPersona = useCallback((persona) => {
    if (!persona) return
    setTtsStability(
      typeof persona.stability === 'number' ? persona.stability : VAPI_ELEVENLABS_VOICE_DEFAULTS.stability
    )
    setTtsSimilarity(
      typeof persona.similarityBoost === 'number'
        ? persona.similarityBoost
        : VAPI_ELEVENLABS_VOICE_DEFAULTS.similarityBoost
    )
    setTtsSpeed(clampVapiElevenLabsSpeedForUi(persona.speed))
    setTtsStyle(
      typeof persona.style === 'number' ? persona.style : VAPI_ELEVENLABS_VOICE_DEFAULTS.style
    )
    setTtsSpeakerBoost(
      typeof persona.useSpeakerBoost === 'boolean' ? persona.useSpeakerBoost : true
    )
  }, [])

  // ── open create dialog ──
  const openCreate = async () => {
    resetEditorState()
    setEditorOpen(true)
    await fetchFormOptions()
  }

  // ── open edit dialog — fetch full data AND options, then prefill ──
  const openEdit = async (assistant) => {
    resetEditorState()
    setEditorOpen(true)
    setEditorLoading(true)
    try {
      // Fetch both in parallel
      const [{ personas: pList, scripts: sList, knowledgeFiles: fList, backgroundSounds: bgList }, detailResult] =
        await Promise.all([
          fetchFormOptions(),
          api.get(`/api/ai-assistant/${assistant._id}`),
        ])

      if (!detailResult.success) {
        toast.error({ title: 'Error', message: detailResult.error || 'Could not load assistant details.' })
        setEditorOpen(false)
        return
      }

      const full = detailResult.data || assistant
      setEditingAssistant(full)
      setName(full.name || '')

      // Match persona: try by provider+voiceId since assistants don't embed persona _id
      const matchedPersona =
        pList.find((p) => p._id === full.persona?._id) ||
        pList.find(
          (p) =>
            p.voiceId === full.persona?.voiceId && p.provider === full.persona?.provider
        )
      setSelectedPersonaId(matchedPersona?._id || '')

      // Match script: try by _id first, then by exact script content
      const matchedScript =
        sList.find((s) => s._id === full.scriptData?._id) ||
        sList.find((s) => String(s.script || '').trim() === String(full.scriptData?.script || '').trim())
      setSelectedScriptId(matchedScript?._id || '')

      // Match knowledge file: normalise the stored fileID/fileIDies to a single string,
      // then match against file.fileID (which is what the select option values use)
      const fileId = normalizeFileId(full.fileID, full.fileIDies)
      const matchedFile =
        fList.find((f) => String(f.fileID || '') === fileId) ||
        fList.find((f) => f._id === fileId)
      setSelectedKnowledgeFileId(matchedFile ? String(matchedFile.fileID || matchedFile._id) : fileId)

      // Message settings
      setFirstMessageMode(full.firstMessageMode || DEFAULT_ASSISTANT_OPTIONS.firstMessageMode)
      setFirstMessage(full.firstMessage || DEFAULT_ASSISTANT_OPTIONS.firstMessage)
      setVoiceMessage(full.voiceMessage || DEFAULT_ASSISTANT_OPTIONS.voiceMessage)
      setBackgroundSound(() => {
        const raw = normalizeBackgroundSoundSelection(full.backgroundSound)
        if (!raw || raw === 'office' || raw === 'static') return raw

        const matched = bgList.find(
          (sound) =>
            sound.url === raw ||
            sound.vapiUrl === raw ||
            sound.previewUrl === raw ||
            (sound.fileID && raw.includes(sound.fileID))
        )
        return matched?.vapiUrl || matched?.url || raw
      })
      setEndCallMessage(full.endCallMessage || DEFAULT_ASSISTANT_OPTIONS.endCallMessage)
      setLlmModel(full.llmModel || DEFAULT_LLM)
      setTemperature(
        clampVapiLlmTemperature(
          typeof full.temperature === 'number' ? full.temperature : DEFAULT_TEMPERATURE,
          DEFAULT_TEMPERATURE
        )
      )
      const savedTts = full.ttsModelId && String(full.ttsModelId).trim()
      setTtsModelId(savedTts || DEFAULT_VAPI_ELEVENLABS_TTS_MODEL_ID)
      const p = full.persona || {}
      setTtsStability(
        typeof p.stability === 'number' ? p.stability : VAPI_ELEVENLABS_VOICE_DEFAULTS.stability
      )
      setTtsSimilarity(
        typeof p.similarityBoost === 'number'
          ? p.similarityBoost
          : VAPI_ELEVENLABS_VOICE_DEFAULTS.similarityBoost
      )
      setTtsSpeed(clampVapiElevenLabsSpeedForUi(p.speed))
      setTtsStyle(typeof p.style === 'number' ? p.style : VAPI_ELEVENLABS_VOICE_DEFAULTS.style)
      setTtsSpeakerBoost(typeof p.useSpeakerBoost === 'boolean' ? p.useSpeakerBoost : true)
      setSuccessEvaluationEnabled(
        typeof full.successEvaluationEnabled === 'boolean' ? full.successEvaluationEnabled : true
      )
      setSuccessEvaluationPrompt(
        typeof full.successEvaluationPrompt === 'string' && full.successEvaluationPrompt.trim()
          ? full.successEvaluationPrompt
          : DEFAULT_SUCCESS_EVALUATION_PROMPT
      )
      setSuccessEvaluationRubric(full.successEvaluationRubric || DEFAULT_SUCCESS_EVALUATION_RUBRIC)
      setLocationID(initLocationID(full))
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not load assistant details.' })
      setEditorOpen(false)
    } finally {
      setEditorLoading(false)
    }
  }

  // ── open preview — fetch full assistant via API ──
  const openPreview = async (assistant) => {
    setPreviewData(null)
    setPreviewKnowledgeNames([])
    setPreviewOpen(true)
    setPreviewLoading(true)
    try {
      const result = await api.get(`/api/ai-assistant/${assistant._id}`)
      if (!result.success) {
        toast.error({ title: 'Error', message: result.error || 'Could not load assistant.' })
        setPreviewOpen(false)
        return
      }
      const full = result.data || assistant
      setPreviewData(full)

      const ids = [
        ...(Array.isArray(full?.fileIDies) ? full.fileIDies : []),
        ...(Array.isArray(full?.fileID) ? full.fileID : []),
      ].filter(Boolean)

      if (ids.length > 0) {
        const kbNames = await Promise.all(
          ids.map(async (id) => {
            const cached = knowledgeFiles.find(
              (f) => String(f.fileID || '') === String(id) || String(f._id || '') === String(id)
            )
            if (cached?.name) return cached.name

            const kbResult = await api.get(`/api/ai-script/file/${id}`)
            if (kbResult.success && kbResult.data?.name) return kbResult.data.name

            return String(id)
          })
        )
        setPreviewKnowledgeNames(kbNames.filter(Boolean))
      }
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not load assistant.' })
      setPreviewOpen(false)
    } finally {
      setPreviewLoading(false)
    }
  }

  // ── save (create or update) ──
  const handleSave = async () => {
    if (!hasLocationSelection(locationID)) {
      toast.error({ title: 'Missing location', message: 'Select one or more studios, or All branches.' })
      return
    }
    if (!canSave) return
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        backgroundSound: resolveBackgroundSoundForSave(backgroundSound),
        endCallMessage: String(endCallMessage || ''),
        firstMessageMode: String(firstMessageMode || ''),
        fileID: String(selectedKnowledgeFile?.fileID || selectedKnowledgeFileId || ''),
        fileIDies: selectedKnowledgeFile?.fileID || selectedKnowledgeFileId
          ? [String(selectedKnowledgeFile?.fileID || selectedKnowledgeFileId)]
          : [],
        firstMessage:
          firstMessageMode === 'assistant-speaks-first-with-model-generated-message'
            ? ''
            : String(firstMessage || ''),
        llmModel: String(llmModel || DEFAULT_LLM),
        temperature: clampVapiLlmTemperature(Number(temperature), DEFAULT_TEMPERATURE),
        ...(selectedPersona.provider === '11labs'
          ? { ttsModelId: String(ttsModelId || DEFAULT_VAPI_ELEVENLABS_TTS_MODEL_ID) }
          : {}),
        persona: {
          provider: selectedPersona.provider,
          voiceId: selectedPersona.voiceId,
          ...(selectedPersona.provider === '11labs'
            ? {
                stability: Number(ttsStability),
                similarityBoost: Number(ttsSimilarity),
                speed: clampVapiElevenLabsSpeedForUi(Number(ttsSpeed)),
                style: Number(ttsStyle),
                useSpeakerBoost: ttsSpeakerBoost,
              }
            : {
                stability: Number(selectedPersona.stability ?? 0.2),
                similarityBoost: Number(selectedPersona.similarityBoost ?? 0.45),
              }),
        },
        scriptData: { script: String(selectedScript.script || '') },
        voiceMessage: String(voiceMessage || ''),
        successEvaluationEnabled,
        successEvaluationPrompt: String(successEvaluationPrompt || '').trim(),
        successEvaluationRubric: String(successEvaluationRubric || DEFAULT_SUCCESS_EVALUATION_RUBRIC),
        ...toLocationPayload(locationID),
      }

      const isEditing = !!editingAssistant
      const updateId = editingAssistant?.assistantID
      const result =
        isEditing && updateId
          ? await api.patch(`/api/ai-assistant/${updateId}`, payload)
          : await api.post('/api/ai-assistant/', payload)

      if (!result.success) {
        toast.error({ title: 'Save failed', message: result.error || 'Could not save assistant.' })
        return
      }

      toast.success({
        title: isEditing ? 'Updated' : 'Created',
        message: `Assistant ${isEditing ? 'updated' : 'created'} successfully.`,
      })

      const savedBg = resolveBackgroundSoundForSave(backgroundSound)
      if (savedBg && !isVapiCallableBackgroundSoundUrl(savedBg)) {
        toast.info({
          title: 'Local background sound',
          message:
            'Your custom sound is saved on this assistant, but Vapi cannot fetch localhost audio on live calls. Use Office/None locally, or deploy with a public HTTPS URL.',
        })
      }

      setEditorOpen(false)
      resetEditorState()
      fetchAssistants()
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not save assistant.' })
    } finally {
      setSaving(false)
    }
  }

  // ── delete ──
  const handleDelete = async (assistant) => {
    if (!assistant?._id) return
    if (!confirm(`Delete assistant "${assistant.name}"? This cannot be undone.`)) return
    setDeletingId(assistant._id)
    try {
      const result = await api.delete(`/api/ai-assistant/${assistant._id}`)
      if (result.success) {
        toast.success({ title: 'Deleted', message: 'Assistant deleted successfully.' })
        if (assistants.length === 1 && page > 1) setPage((p) => Math.max(1, p - 1))
        else fetchAssistants()
      } else {
        toast.error({ title: 'Delete failed', message: result.error || 'Could not delete assistant.' })
      }
    } catch (e) {
      console.error(e)
      toast.error({ title: 'Error', message: 'Could not delete assistant.' })
    } finally {
      setDeletingId(null)
    }
  }

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages])

  return (
    <TabsContent value="assistants" className="mt-6 flex-1 min-h-0 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-2xl">
          Create reusable assistants (e.g. Booking, Promo, Marketing) by combining persona, script,
          knowledge base, and success evaluator. Use them in Make Calls and review outcomes in AI
          Calling Data filtered by assistant.
        </p>
        <Button variant="gradient" className="w-full sm:w-auto" onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          Create assistant
        </Button>
      </div>

      {/* Search */}
      <SearchInput
        className="max-w-sm"
        placeholder="Search assistants…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

      {/* States */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <LoadingSpinner size="lg" text="Loading assistants…" />
        </div>
      )}

      {error && !loading && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && assistants.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Bot className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="font-medium text-muted-foreground">No AI assistants yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create one to reuse setup in make-calls.</p>
          </CardContent>
        </Card>
      )}

      {/* Grid */}
      {!loading && !error && assistants.length > 0 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {assistants.map((assistant) => {
              const locLabel = locationBadgeLabel(assistant)
              return (
              <Card key={assistant._id} className="rounded-xl border-border/80 hover:shadow-md transition-all flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base line-clamp-1">{assistant.name || 'Unnamed assistant'}</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1 truncate">
                        Voice: <span className="font-medium">{assistant.persona?.voiceId || '—'}</span>
                        {' · '}
                        Provider: <span className="font-medium">{assistant.persona?.provider || '—'}</span>
                      </p>
                      {locLabel && (
                        <Badge variant="secondary" className="mt-1.5 text-[10px] font-normal">
                          {locLabel}
                        </Badge>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {formatBackgroundSoundLabel(assistant.backgroundSound, backgroundSounds)}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="flex flex-col gap-3 flex-1">
                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap flex-1">
                    {assistant.scriptData?.script || 'No script attached'}
                  </p>

                  {/* Actions row */}
                  <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                    <Button
                      variant="gradient"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => openPreview(assistant)}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1.5" />
                      Preview
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => openEdit(assistant)}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(assistant)}
                      disabled={deletingId === assistant._id}
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      title="Delete"
                    >
                      {deletingId === assistant._id
                        ? <GlobalLoader variant="inline" size="xs" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
            })}
          </div>

          {/* Pagination */}
          <div className="flex flex-col gap-3 pt-2 mt-auto">
            <div className="flex items-center justify-center gap-1.5 flex-wrap">
              {pageNumbers.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPage(n)}
                  disabled={loading || n === page}
                  className={`inline-flex items-center justify-center h-8 min-w-8 px-2 rounded-md text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    n === page
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:bg-muted/40'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages} ({totalCount} total)
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
                className="h-8 px-3 rounded-lg border border-border bg-background text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── EDITOR DIALOG ── */}
      <Dialog
        open={editorOpen}
        onClose={() => {
          if (saving || editorLoading) return
          setEditorOpen(false)
          resetEditorState()
        }}
        maxWidth="3xl"
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto" onClose={() => {
          if (saving || editorLoading) return
          setEditorOpen(false)
          resetEditorState()
        }}>
          <DialogHeader>
            <DialogTitle>{editingAssistant ? 'Edit assistant' : 'Create assistant'}</DialogTitle>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            {(editorLoading || optionsLoading) && (
              <div className="flex items-center gap-2 py-2">
                <GlobalLoader variant="inline" size="sm" />
                <span className="text-xs text-muted-foreground">
                  {editorLoading ? 'Loading assistant details…' : 'Loading options…'}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5 md:col-span-2">
                <p className="text-sm font-medium">Studio location *</p>
                <LocationSelector
                  value={locationID}
                  onChange={setLocationID}
                  multiple
                  allowAllBranches
                  showAllOption={false}
                  placeholder="Select studio(s)…"
                  disabled={editorLoading}
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <p className="text-sm font-medium">Assistant name</p>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Dance Studio America"
                  disabled={editorLoading}
                />
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Persona <span className="text-destructive">*</span></p>
                <Select
                  value={selectedPersonaId}
                  onChange={(e) => {
                    const id = e.target.value
                    setSelectedPersonaId(id)
                    const p = personas.find((x) => x._id === id)
                    if (p) syncVoiceTuningFromPersona(p)
                  }}
                  disabled={editorLoading}
                >
                  <option value="">Select persona</option>
                  {personas.map((persona) => (
                    <option key={persona._id} value={persona._id}>
                      {persona.voice || persona.voiceId || 'Unnamed persona'}
                    </option>
                  ))}
                </Select>
                {editingAssistant && !selectedPersonaId && !editorLoading && (
                  <p className="text-[11px] text-amber-600">
                    No matching persona found for voice "{editingAssistant.persona?.voiceId}" — please select one.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Script <span className="text-destructive">*</span></p>
                <Select value={selectedScriptId} onChange={(e) => setSelectedScriptId(e.target.value)} disabled={editorLoading}>
                  <option value="">Select script</option>
                  {scripts.map((script) => (
                    <option key={script._id} value={script._id}>
                      {script.name || 'Untitled script'}
                    </option>
                  ))}
                </Select>
                {editingAssistant && !selectedScriptId && !editorLoading && (
                  <p className="text-[11px] text-amber-600">
                    Script not found in library — please select one.
                  </p>
                )}
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <p className="text-sm font-medium">Knowledge base file <span className="text-muted-foreground text-xs font-normal">(optional)</span></p>
                <Select
                  value={selectedKnowledgeFileId}
                  onChange={(e) => setSelectedKnowledgeFileId(e.target.value)}
                  disabled={editorLoading}
                >
                  <option value="">No file</option>
                  {knowledgeFiles.map((file) => (
                    <option key={file._id} value={file.fileID || file._id}>
                      {file.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="md:col-span-2 rounded-lg border border-border/80 bg-muted/30 p-4 space-y-4">
                <div>
                  <p className="text-sm font-semibold">Vapi model and voice settings</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    These settings are saved on the Vapi assistant. When the selected persona uses an
                    ElevenLabs voice, the TTS model and voice tuning are sent through Vapi voice config.
                  </p>
                </div>
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">LLM model</p>
                    <Select
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      disabled={editorLoading}
                      className="font-mono text-xs"
                    >
                      {llmSelectOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Temperature ({temperature}) - 0 to 1</p>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      disabled={editorLoading}
                      className="w-full"
                    />
                  </div>
                </div>

                {selectedPersona?.provider === '11labs' && (
                  <div className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-3">
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium">ElevenLabs voice through Vapi</p>
                      <Select
                        value={ttsModelId}
                        onChange={(e) => setTtsModelId(e.target.value)}
                        disabled={editorLoading}
                      >
                        {VAPI_ELEVENLABS_VOICE_MODEL_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Stability ({ttsStability.toFixed(2)})</p>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={ttsStability}
                        onChange={(e) => setTtsStability(Number(e.target.value))}
                        disabled={editorLoading}
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Similarity boost ({ttsSimilarity.toFixed(2)})</p>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={ttsSimilarity}
                        onChange={(e) => setTtsSimilarity(Number(e.target.value))}
                        disabled={editorLoading}
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">
                        Speed ({ttsSpeed.toFixed(2)}) - Vapi max {VAPI_ELEVENLABS_SPEED_MAX.toFixed(1)}
                      </p>
                      <input
                        type="range"
                        min={VAPI_ELEVENLABS_SPEED_MIN}
                        max={VAPI_ELEVENLABS_SPEED_MAX}
                        step={0.05}
                        value={ttsSpeed}
                        onChange={(e) =>
                          setTtsSpeed(clampVapiElevenLabsSpeedForUi(Number(e.target.value)))
                        }
                        disabled={editorLoading}
                        className="w-full"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-medium">Style ({ttsStyle.toFixed(2)})</p>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={ttsStyle}
                        onChange={(e) => setTtsStyle(Number(e.target.value))}
                        disabled={editorLoading}
                        className="w-full"
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ttsSpeakerBoost}
                        onChange={() => setTtsSpeakerBoost((v) => !v)}
                        disabled={editorLoading}
                      />
                      Speaker boost
                    </label>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium">First message mode</p>
                <Select value={firstMessageMode} onChange={(e) => setFirstMessageMode(e.target.value)} disabled={editorLoading}>
                  <option value="assistant-waits-for-user">assistant-waits-for-user</option>
                  <option value="assistant-speaks-first-with-model-generated-message">
                    assistant-speaks-first-with-model-generated-message
                  </option>
                  <option value="assistant-speaks-first">assistant-speaks-first</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">Voice message</p>
                <p className="text-[11px] text-muted-foreground">
                  Played when the call goes to voicemail. Leave blank to skip leaving a message.
                </p>
                <Input value={voiceMessage} onChange={(e) => setVoiceMessage(e.target.value)} disabled={editorLoading} placeholder="Hey, I tried calling you!" />
              </div>

                <div>
                  <label htmlFor="assistant-bg-sound" className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Background sound
                  </label>
                  <Select
                    id="assistant-bg-sound"
                    value={backgroundSound}
                    onChange={(e) => setBackgroundSound(e.target.value)}
                    disabled={editorLoading}
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-[13px]"
                  >
                    {BUILTIN_BACKGROUND_SOUNDS.map((opt) => (
                      <option key={opt.value || 'bg-none'} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                    {selectableBackgroundSounds.length > 0 && (
                      <optgroup label="Custom sounds">
                        {selectableBackgroundSounds.map((sound) => (
                          <option
                            key={sound._id}
                            value={resolveBackgroundSoundOptionValue(sound, getApiBaseUrl())}
                          >
                            {sound.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Upload more in the <span className="font-medium">Background Sounds</span> tab. Custom
                    sound volume is managed there and reused everywhere. Local{' '}
                    <code className="text-[10px]">http://localhost</code> URLs can be saved for testing; live Vapi
                    calls need a public HTTPS URL.
                  </p>
                </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium">End call message</p>
                <Input value={endCallMessage} onChange={(e) => setEndCallMessage(e.target.value)} disabled={editorLoading} />
              </div>

              {firstMessageMode !== 'assistant-speaks-first-with-model-generated-message' && (
                <div className="space-y-1.5 md:col-span-2">
                  <p className="text-sm font-medium">First message</p>
                  <Textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} disabled={editorLoading} />
                </div>
              )}
            </div>

            <div className="rounded-lg border border-border/80 bg-muted/30 p-4 space-y-4">
              <div>
                <p className="text-sm font-semibold">Success evaluator</p>
                <p className="text-xs text-muted-foreground mt-1">
                  After each call ends, Vapi evaluates whether the call was successful using your
                  custom criteria. Results appear in AI Calling Data.
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={successEvaluationEnabled}
                  onChange={() => setSuccessEvaluationEnabled((v) => !v)}
                  disabled={editorLoading}
                />
                Enable success evaluation
              </label>

              {successEvaluationEnabled && (
                <>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Evaluation rubric</p>
                    <Select
                      value={successEvaluationRubric}
                      onChange={(e) => setSuccessEvaluationRubric(e.target.value)}
                      disabled={editorLoading}
                    >
                      {VAPI_SUCCESS_EVALUATION_RUBRICS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">Evaluation prompt</p>
                    <Textarea
                      value={successEvaluationPrompt}
                      onChange={(e) => setSuccessEvaluationPrompt(e.target.value)}
                      placeholder="Describe what counts as a successful call for your use case…"
                      disabled={editorLoading}
                      rows={5}
                      className="text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Leave blank to use Vapi&apos;s default evaluator. Customize this to match your
                      script goals (e.g. booked trial, collected email, answered key questions).
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditorOpen(false)
                  resetEditorState()
                }}
                disabled={saving || editorLoading}
              >
                Cancel
              </Button>
              <Button variant="gradient" onClick={handleSave} disabled={saving || editorLoading || !canSave}>
                {saving ? 'Saving…' : editingAssistant ? 'Update assistant' : 'Create assistant'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── PREVIEW DIALOG ── */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="3xl">
        <DialogContent className="max-h-[90vh] overflow-y-auto" onClose={() => setPreviewOpen(false)}>
          <DialogHeader>
            <DialogTitle>Assistant preview</DialogTitle>
          </DialogHeader>

          {previewLoading && (
            <div className="flex items-center justify-center py-12">
              <LoadingSpinner size="md" text="Loading assistant…" />
            </div>
          )}

          {!previewLoading && previewData && (
            <div className="mt-4 space-y-4">
              {/* Identity */}
              <div className="flex items-start gap-3 rounded-lg border border-border p-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-foreground">{previewData.name || 'Unnamed assistant'}</p>
                  <div className="flex flex-wrap gap-2 mt-1.5">
                    <Badge variant="outline" className="text-xs">
                      {previewData.persona?.provider || 'unknown provider'}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Voice: {previewData.persona?.voiceId || '—'}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {formatBackgroundSoundLabel(previewData.backgroundSound, backgroundSounds)}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      LLM: {previewData.llmModel || DEFAULT_LLM}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      temp: {previewData.temperature ?? '—'}
                    </Badge>
                    {previewData.persona?.provider === '11labs' && (
                      <Badge variant="outline" className="text-xs font-mono">
                        ElevenLabs voice: {previewData.ttsModelId || DEFAULT_VAPI_ELEVENLABS_TTS_MODEL_ID}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

             

              {/* Message settings */}
              <div className="rounded-lg border border-border p-3 space-y-1.5 text-xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Message settings</p>
                {[
                  ['First message mode', previewData.firstMessageMode || '—'],
                  [
                    'First message',
                    previewData.firstMessageMode === 'assistant-speaks-first-with-model-generated-message'
                      ? 'Generated from script by model'
                      : (previewData.firstMessage || '—'),
                  ],
                  ['Voice message', previewData.voiceMessage || '—'],
                  [
                    'Background sound',
                    formatBackgroundSoundLabel(previewData.backgroundSound, backgroundSounds),
                  ],
                  ['End call message', previewData.endCallMessage || '—'],
                ].map(([label, val]) => (
                  <div key={label} className="flex justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">{label}</span>
                    <span className="font-medium text-foreground text-right">{val}</span>
                  </div>
                ))}
              </div>

              {/* Success evaluator */}
              <div className="rounded-lg border border-border p-3 space-y-1.5 text-xs">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Success evaluator
                </p>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Enabled</span>
                  <span className="font-medium text-foreground text-right">
                    {previewData.successEvaluationEnabled === false ? 'No' : 'Yes'}
                  </span>
                </div>
                {previewData.successEvaluationEnabled !== false && (
                  <>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground shrink-0">Rubric</span>
                      <span className="font-medium text-foreground text-right">
                        {previewData.successEvaluationRubric || DEFAULT_SUCCESS_EVALUATION_RUBRIC}
                      </span>
                    </div>
                    <div className="pt-1">
                      <p className="text-muted-foreground mb-1">Prompt</p>
                      <p className="text-foreground whitespace-pre-wrap leading-relaxed">
                        {previewData.successEvaluationPrompt?.trim() ||
                          DEFAULT_SUCCESS_EVALUATION_PROMPT}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* Knowledge files */}
              {(() => {
                const ids = [
                  ...(Array.isArray(previewData.fileIDies) ? previewData.fileIDies : []),
                  ...(Array.isArray(previewData.fileID) ? previewData.fileID : []),
                ].filter(Boolean)
                return ids.length > 0 ? (
                  <div className="rounded-lg border border-border p-3 text-xs">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Knowledge base</p>
                    {(previewKnowledgeNames.length ? previewKnowledgeNames : ids).map((name) => (
                      <p key={name} className="text-muted-foreground truncate">{name}</p>
                    ))}
                  </div>
                ) : null
              })()}

              {/* Script */}
              <div className="rounded-lg border border-border p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Script</p>
                <pre className="text-xs text-foreground whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
                  {previewData.scriptData?.script || 'No script'}
                </pre>
              </div>

              <div className="flex justify-end pt-1">
                <Button variant="outline" onClick={() => setPreviewOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TabsContent>
  )
}
