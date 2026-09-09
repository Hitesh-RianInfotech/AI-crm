/**
 * Convert a UTC Date to a Date whose local getters (.getHours, .getDate, …) return the
 * studio wall-clock time in `tz`. Calendar day/week layout reads those getters, so this
 * must work in any browser timezone — including IST.
 *
 * Build with the numeric Date constructor (browser-local components), NOT a `…Z` ISO
 * string. Treating studio wall-clock as UTC only works when the browser itself is UTC;
 * in India that wrongly shifts a Midtown 6pm booking to 11:30pm.
 */
export function toStudioLocalDate(date, tz) {
  if (!tz) return date;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const p = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    const hour = Number(p.hour === '24' ? '0' : p.hour)
    return new Date(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      hour,
      Number(p.minute),
      Number(p.second),
    )
  } catch {
    return date
  }
}

/**
 * Format a lesson/appointment instant in the STUDIO's timezone.
 *
 * Appointment times are stored as UTC instants. Formatting them without an explicit
 * `timeZone` renders them in whatever zone the viewer's browser happens to be in, so
 * the same booking reads 6:00 PM in New York and 3:00 PM in Los Angeles. Always pass
 * the studio timezone. When `tz` is missing we fall back to browser-local rather than
 * throwing — the caller is still loading it.
 */
export function formatStudioDate(value, tz, options = {}) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    ...(tz ? { timeZone: tz } : {}),
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...options,
  })
}

export function formatStudioTime(value, tz, options = {}) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', {
    ...(tz ? { timeZone: tz } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...options,
  })
}

/**
 * Turn an `<input type="date">` value ("2026-09-04") into an ISO instant that still
 * reads as that calendar day.
 *
 * A bare `YYYY-MM-DD` is parsed as UTC midnight per spec, so `new Date('2026-09-04')`
 * on the backend stores 2026-09-04T00:00Z — which the payment timeline, rendered in
 * browser-local time, showed as "3 Sept 2026 · 7:00 pm" for a UTC-5 viewer. Build the
 * instant from local components instead so the day never shifts backwards.
 *
 * Keeps the current wall-clock time, so a payment recorded today is timestamped at the
 * moment it was actually taken rather than at midnight.
 */
export function dateInputToISO(ymd) {
  if (!ymd) return undefined
  const [y, m, d] = String(ymd).split('-').map(Number)
  if (!y || !m || !d) return undefined
  const now = new Date()
  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString()
}

/**
 * Today as an `<input type="date">` value ("2026-09-04"), in the viewer's own zone.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day, so it pre-fills tomorrow for
 * a US user recording an evening payment, and yesterday for an early-morning IST one.
 */
export function todayDateInput() {
  return new Date().toLocaleDateString('en-CA')
}
