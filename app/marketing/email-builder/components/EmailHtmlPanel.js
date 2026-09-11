'use client'

import { useMemo } from 'react'
import { Copy, Layout, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { ADMIN_TEMPLATE_VARIABLES, STUDIO_TEMPLATE_VARIABLES } from '@/lib/template-scope'

const MERGE_TAGS = [
  '{{name}}',
  '{{first_name}}',
  '{{email}}',
  ...STUDIO_TEMPLATE_VARIABLES.map((v) => v.name),
  ...ADMIN_TEMPLATE_VARIABLES.map((v) => v.name),
]

export default function EmailHtmlPanel({
  htmlBody,
  onHtmlBodyChange,
  onSyncFromVisual,
  showSyncFromVisual = false,
  onOpenDesign,
  readOnly = false,
  minRows = 14,
  layout = 'editor-only',
  className,
}) {
  const toast = useToast()
  const previewHtml = useMemo(() => String(htmlBody || '').trim(), [htmlBody])
  const charCount = String(htmlBody || '').length
  const lineCount = String(htmlBody || '').split('\n').length
  const editorOnly = layout === 'editor-only'
  const hasContent = !!previewHtml

  const copyHtml = async () => {
    const text = String(htmlBody || '')
    if (!text.trim()) {
      toast.error({ title: 'Nothing to copy', message: 'Add HTML content first.' })
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success({ title: 'Copied', message: 'HTML copied to clipboard.' })
    } catch {
      toast.error({ title: 'Copy failed', message: 'Could not copy to clipboard.' })
    }
  }

  const insertTag = (tag) => {
    if (readOnly) return
    const current = String(htmlBody || '')
    onHtmlBodyChange?.(current ? `${current}${tag}` : tag)
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-0 w-full min-h-0',
        editorOnly ? 'h-full flex-1' : 'min-h-[380px]',
        className,
      )}
    >
      <div
        className={cn(
          'flex flex-col min-h-0 flex-1 w-full rounded-xl border border-slate-800/20 overflow-hidden shadow-sm',
          editorOnly && 'min-h-[280px]',
        )}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 bg-slate-900 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full bg-red-400/80" />
            <span className="h-2 w-2 rounded-full bg-amber-400/80" />
            <span className="h-2 w-2 rounded-full bg-emerald-400/80" />
            <span className="ml-1.5 text-[10px] font-mono text-slate-400">email.html</span>
            <span className="text-[10px] tabular-nums text-slate-500 hidden sm:inline">
              {lineCount} lines · {charCount.toLocaleString()}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!readOnly
              ? MERGE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    title={`Insert ${tag}`}
                    className="rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    {tag}
                  </button>
                ))
              : null}
            {showSyncFromVisual && onSyncFromVisual && !readOnly ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onSyncFromVisual}
                className="h-7 text-[11px] text-slate-300 hover:text-white hover:bg-slate-800"
                title="Discard custom HTML and regenerate from Design blocks"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Reset
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={copyHtml}
              disabled={!hasContent}
              className="h-7 text-[11px] text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <Copy className="h-3 w-3 mr-1" />
              Copy
            </Button>
            {hasContent && onOpenDesign && !readOnly ? (
              <Button
                type="button"
                size="sm"
                onClick={onOpenDesign}
                className="h-7 text-[11px] bg-white text-slate-900 hover:bg-slate-100"
              >
                <Layout className="h-3 w-3 mr-1" />
                Design
              </Button>
            ) : null}
          </div>
        </div>
        <Textarea
          value={htmlBody}
          onChange={(e) => onHtmlBodyChange?.(e.target.value)}
          readOnly={readOnly}
          rows={editorOnly ? 24 : minRows}
          placeholder={`<!-- Paste your email HTML here -->\n\n<h1>Welcome, {{name}}!</h1>\n<p>We are excited to have you at the studio.</p>`}
          className={cn(
            'flex-1 w-full min-h-0 resize-none rounded-none border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0',
            'font-mono text-[13px] leading-relaxed px-4 py-3',
            editorOnly ? 'min-h-[240px] h-full' : 'min-h-[200px]',
            readOnly
              ? 'bg-slate-50 text-slate-700 cursor-default'
              : 'bg-slate-950 text-slate-100 placeholder:text-slate-600',
          )}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
