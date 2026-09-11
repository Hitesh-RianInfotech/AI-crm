'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { customerLifecycleLabel } from '@/lib/customer-lifecycle'

/**
 * A customer's status timeline, plus any override currently holding it in place.
 *
 * Exists because the generic activity log cannot answer this: its API has no entityId
 * filter, and customer activity rows record neither the from/to pair nor a reason. The
 * StatusTransition collection stores all of it — who or which rule, and why.
 *
 * Refusals and suppressions are shown, not just successful changes. "The rules wanted to
 * move this customer to Inactive but an override held it" is usually the row someone is
 * actually looking for.
 */

const OUTCOME_STYLE = {
  applied: { label: 'Changed', cls: 'text-foreground' },
  refused_requirements: { label: 'Refused', cls: 'text-destructive' },
  suppressed_override: { label: 'Held by override', cls: 'text-amber-600 dark:text-amber-500' },
  conflict: { label: 'Conflict', cls: 'text-muted-foreground' },
}

function formatWhen(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

/** Who or what caused it — a rule name beats a bare "automation". */
function actorLabel(t) {
  if (t.ruleName) return `rule "${t.ruleName}"`
  if (t.source === 'manual') return t.actorUserID?.name || t.actorUserID?.email || 'a person'
  if (t.source === 'import') return 'an import'
  if (t.source === 'system') return 'the system'
  return 'automation'
}

export default function CustomerStatusHistory({ customerID, refreshKey = 0 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!customerID) return
    setLoading(true)
    const res = await api.get(`/api/customer/${customerID}/status-history`)
    // Silent on failure: this is a supporting panel, and a toast here would fire on
    // every page load for anyone whose role cannot read it.
    setData(res.success ? res.data : null)
    setLoading(false)
  }, [customerID])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  if (loading && !data) {
    return <p className="text-[12px] text-muted-foreground">Loading status history…</p>
  }
  if (!data) return null

  const { statusOverride, transitions = [] } = data

  return (
    <div className="space-y-3">
      {statusOverride ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-[12px] font-medium text-amber-700 dark:text-amber-400">
            Status overridden
            {statusOverride.byUserID?.name ? ` by ${statusOverride.byUserID.name}` : ''}
          </p>
          {statusOverride.reason && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">{statusOverride.reason}</p>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Automation will not change this status while the override stands.
          </p>
        </div>
      ) : null}

      {transitions.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No status changes recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {transitions.map((t) => {
            const style = OUTCOME_STYLE[t.outcome] || OUTCOME_STYLE.applied
            return (
              <li key={t._id} className="rounded-lg border border-border bg-card px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[12px] font-medium ${style.cls}`}>{style.label}</span>
                  <span className="text-[13px] text-foreground">
                    {customerLifecycleLabel(t.fromStatus) || '—'} → {customerLifecycleLabel(t.toStatus)}
                  </span>
                  {t.isOverride && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Override
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatWhen(t.createdAt)} · by {actorLabel(t)}
                </p>
                {t.note && (
                  <p className="mt-1 text-[12px] text-foreground">{t.note}</p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
