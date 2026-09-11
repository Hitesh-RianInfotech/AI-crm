'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, Workflow } from 'lucide-react'
import api from '@/lib/api'
import { getEffectiveBranch } from '@/lib/auth'
import { extractDynamicListsList } from '@/lib/dynamic-list-normalize'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

const STARTERS = [
  'I want a welcome workflow for new leads',
  'Follow up with customers who haven’t booked in 30 days',
  'Send a birthday SMS and email to customers',
]

function extractAiBuilderPayload(res) {
  const raw = res?.data
  if (!raw || typeof raw !== 'object') return null
  if ('reply' in raw || 'isComplete' in raw || 'workflowDraft' in raw) return raw
  if (raw.data && typeof raw.data === 'object') return raw.data
  return null
}

function normalizeListId(value) {
  if (!value) return ''
  if (typeof value === 'object') return String(value._id || value.id || '').trim()
  return String(value).trim()
}

function prepareWorkflowDraftForCreate(draft) {
  const body = { ...(draft || {}) }
  const audienceMode =
    body.audienceMode === 'list' ? 'list' : body.audienceMode === 'all' ? 'all' : body.audienceMode
  const listID = normalizeListId(body.listID)

  if (audienceMode === 'list') {
    if (!listID) {
      return {
        ok: false,
        error: 'Select a dynamic list before creating this workflow.',
      }
    }
    body.audienceMode = 'list'
    body.listID = listID
  } else if (audienceMode === 'all') {
    body.audienceMode = 'all'
    body.listID = null
  } else if (listID) {
    body.audienceMode = 'list'
    body.listID = listID
  }

  return { ok: true, body }
}

/**
 * Side panel to design a workflow via POST /api/workflow/ai-builder,
 * then create it with POST /api/workflow using the returned draft.
 * Does not touch the blank builder create flow.
 */
export default function CreateWorkflowWithAISheet({
  open,
  onClose,
  onCreated,
}) {
  const [history, setHistory] = useState([])
  const [workflowDraft, setWorkflowDraft] = useState(null)
  const [isComplete, setIsComplete] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [dynamicLists, setDynamicLists] = useState([])
  const [loadingLists, setLoadingLists] = useState(false)
  const bottomRef = useRef(null)

  const entityType = workflowDraft?.entityType === 'customer' ? 'customer' : 'lead'
  const needsListPicker =
    Boolean(workflowDraft) &&
    workflowDraft.audienceMode === 'list' &&
    !normalizeListId(workflowDraft.listID)

  useEffect(() => {
    if (!open) return
    setHistory([])
    setWorkflowDraft(null)
    setIsComplete(false)
    setInput('')
    setSending(false)
    setCreating(false)
    setError('')
    setDynamicLists([])
  }, [open])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history, workflowDraft, sending, error, needsListPicker])

  useEffect(() => {
    if (!open || !isComplete || !workflowDraft) return
    if (workflowDraft.audienceMode !== 'list') return

    let cancelled = false
    setLoadingLists(true)
    api
      .get(`/api/dynamic-list?status=active&limit=200&entityType=${entityType}`)
      .then((res) => {
        if (cancelled) return
        const lists = res?.success ? extractDynamicListsList(res) : []
        setDynamicLists(lists.filter((l) => (l?.entityType || 'lead') === entityType))
        setLoadingLists(false)
      })
      .catch(() => {
        if (!cancelled) {
          setDynamicLists([])
          setLoadingLists(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, isComplete, workflowDraft?.audienceMode, entityType])

  const selectedListName = useMemo(() => {
    const id = normalizeListId(workflowDraft?.listID)
    if (!id) return ''
    const hit = dynamicLists.find((l) => String(l._id || l.id) === id)
    return hit?.name || workflowDraft?.listName || ''
  }, [workflowDraft?.listID, workflowDraft?.listName, dynamicLists])

  const sendMessage = async (rawMessage) => {
    const message = String(rawMessage || '').trim()
    if (!message || sending || creating) return

    setError('')
    setSending(true)
    const historySnapshot = history

    const res = await api.post('/api/workflow/ai-builder', {
      message,
      history: historySnapshot,
    })

    setSending(false)

    if (!res?.success) {
      setError(res?.error || 'AI builder failed. Please try again.')
      return
    }

    const payload = extractAiBuilderPayload(res)
    const reply = String(payload?.reply || '').trim() || 'Got it.'

    setHistory((prev) => [
      ...prev,
      { role: 'user', content: message },
      { role: 'assistant', content: reply },
    ])
    setInput('')

    if (payload?.isComplete) {
      const draft = payload.workflowDraft ? { ...payload.workflowDraft } : null
      if (draft?.audienceMode === 'list') {
        draft.listID = normalizeListId(draft.listID) || ''
      }
      setWorkflowDraft(draft)
      setIsComplete(true)
    } else {
      setWorkflowDraft(null)
      setIsComplete(false)
    }
  }

  const confirmCreate = async () => {
    if (!workflowDraft || creating) return
    setError('')

    const prepared = prepareWorkflowDraftForCreate(workflowDraft)
    if (!prepared.ok) {
      setError(prepared.error)
      return
    }

    setCreating(true)
    const body = prepared.body
    const branch = getEffectiveBranch()
    if (branch) body.locationID = branch

    const res = await api.post('/api/workflow/', body)
    setCreating(false)

    if (!res?.success) {
      setError(res?.error || 'Failed to create workflow.')
      return
    }

    const id = res.data?._id || res.data?.id
    onCreated?.(id, res.data)
    onClose?.()
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const stepCount = Array.isArray(workflowDraft?.steps) ? workflowDraft.steps.length : 0
  const canCreate =
    Boolean(workflowDraft) &&
    !(workflowDraft.audienceMode === 'list' && !normalizeListId(workflowDraft.listID))

  return (
    <Sheet open={open} onClose={creating ? undefined : onClose} side="right" width="440px">
      <SheetContent
        onClose={creating ? undefined : onClose}
        className="overflow-hidden p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border px-5 py-4 pr-12">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/15 text-brand">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <SheetTitle>Create with AI</SheetTitle>
                <SheetDescription>
                  Describe the automation — I&apos;ll ask a few questions, then draft the workflow.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            {history.length === 0 && !sending ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Try a starter, or type your own idea below.
                </p>
                <div className="flex flex-col gap-2">
                  {STARTERS.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => sendMessage(text)}
                      className="rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-muted/50"
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {history.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className={cn(
                  'max-w-[92%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                  msg.role === 'user'
                    ? 'ml-auto bg-brand text-brand-foreground'
                    : 'mr-auto border border-border bg-muted/40 text-foreground',
                )}
              >
                {msg.content}
              </div>
            ))}

            {sending ? (
              <div className="mr-auto flex items-center gap-2 rounded-2xl border border-border bg-muted/40 px-3.5 py-2.5 text-[13px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking…
              </div>
            ) : null}

            {isComplete && workflowDraft ? (
              <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Workflow className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {workflowDraft.name || 'Untitled workflow'}
                    </p>
                    {workflowDraft.description ? (
                      <p className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
                        {workflowDraft.description}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                      <span className="rounded-full bg-muted px-2 py-0.5">
                        {stepCount} step{stepCount === 1 ? '' : 's'}
                      </span>
                      {workflowDraft.audienceMode ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 capitalize">
                          Audience: {workflowDraft.audienceMode}
                        </span>
                      ) : null}
                      {workflowDraft.entityType ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 capitalize">
                          {workflowDraft.entityType}
                        </span>
                      ) : null}
                      {selectedListName ? (
                        <span className="rounded-full bg-muted px-2 py-0.5">
                          List: {selectedListName}
                        </span>
                      ) : null}
                    </div>

                    {workflowDraft.audienceMode === 'list' ? (
                      <div className="mt-3 space-y-2">
                        <label className="text-[12px] font-medium text-foreground">
                          Dynamic list
                          {needsListPicker ? (
                            <span className="font-normal text-destructive"> (required)</span>
                          ) : null}
                        </label>
                        <Select
                          value={normalizeListId(workflowDraft.listID)}
                          disabled={loadingLists || creating}
                          onChange={(e) => {
                            const listID = e.target.value
                            const hit = dynamicLists.find(
                              (l) => String(l._id || l.id) === listID,
                            )
                            setWorkflowDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    audienceMode: 'list',
                                    listID,
                                    listName: hit?.name || '',
                                  }
                                : prev,
                            )
                            setError('')
                          }}
                          className="h-9 text-[13px]"
                        >
                          <option value="">
                            {loadingLists ? 'Loading lists…' : 'Select a list…'}
                          </option>
                          {dynamicLists.map((list) => {
                            const id = String(list._id || list.id)
                            return (
                              <option key={id} value={id}>
                                {list.name || id}
                              </option>
                            )
                          })}
                        </Select>
                        <button
                          type="button"
                          className="text-[12px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                          onClick={() => {
                            setWorkflowDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    audienceMode: 'all',
                                    listID: null,
                                    listName: '',
                                  }
                                : prev,
                            )
                            setError('')
                          }}
                        >
                          Use everyone instead (audience: all)
                        </button>
                      </div>
                    ) : null}

                    <Button
                      className="mt-3 w-full"
                      variant="gradient"
                      disabled={creating || !canCreate}
                      onClick={confirmCreate}
                    >
                      {creating ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating…
                        </>
                      ) : (
                        'Create Workflow'
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                {error}
              </div>
            ) : null}

            <div ref={bottomRef} />
          </div>

          <div className="border-t border-border p-4">
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isComplete
                    ? 'Ask to adjust the draft, or create it above…'
                    : 'Describe the workflow you want…'
                }
                rows={2}
                disabled={sending || creating}
                className="min-h-[64px] resize-none text-[13px]"
              />
              <Button
                type="button"
                size="icon"
                variant="gradient"
                className="h-10 w-10 shrink-0"
                disabled={sending || creating || !input.trim()}
                onClick={() => sendMessage(input)}
                aria-label="Send"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Enter to send · Shift+Enter for a new line
            </p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
