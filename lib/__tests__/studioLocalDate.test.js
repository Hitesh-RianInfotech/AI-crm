import { describe, it, expect } from 'vitest'
import { formatStudioDate, formatStudioTime, dateInputToISO, todayDateInput } from '../studioLocalDate'

// A booking stored as 2026-08-14T22:00:00Z is 6:00 PM in New York and 3:00 PM in
// Los Angeles. Formatting without an explicit timeZone renders whatever zone the
// viewer's browser is in, which is what made the appointments sidebar disagree
// with the calendar for the same lesson.
const LESSON_UTC = '2026-08-14T22:00:00.000Z'

describe('formatStudioTime', () => {
  it('renders the studio wall clock, not the viewer zone', () => {
    expect(formatStudioTime(LESSON_UTC, 'America/New_York')).toBe('6:00 PM')
    expect(formatStudioTime(LESSON_UTC, 'America/Los_Angeles')).toBe('3:00 PM')
    expect(formatStudioTime(LESSON_UTC, 'America/Chicago')).toBe('5:00 PM')
  })

  it('handles empty and invalid input without throwing', () => {
    expect(formatStudioTime(null, 'America/New_York')).toBe('—')
    expect(formatStudioTime('', 'America/New_York')).toBe('—')
    expect(formatStudioTime('not-a-date', 'America/New_York')).toBe('—')
  })

  it('falls back to browser-local when the timezone has not loaded yet', () => {
    expect(formatStudioTime(LESSON_UTC, null)).toEqual(expect.any(String))
  })
})

describe('formatStudioDate', () => {
  it('keeps the studio calendar day across a zone boundary', () => {
    // 2026-08-15T02:00Z is still Aug 14 in every US zone.
    const lateNight = '2026-08-15T02:00:00.000Z'
    expect(formatStudioDate(lateNight, 'America/New_York')).toBe('Fri, Aug 14')
    expect(formatStudioDate(lateNight, 'America/Los_Angeles')).toBe('Fri, Aug 14')
  })

  it('accepts option overrides such as year', () => {
    expect(formatStudioDate(LESSON_UTC, 'America/New_York', { year: 'numeric' })).toBe(
      'Fri, Aug 14, 2026',
    )
  })

  it('handles empty and invalid input without throwing', () => {
    expect(formatStudioDate(null, 'America/New_York')).toBe('—')
    expect(formatStudioDate('not-a-date', 'America/New_York')).toBe('—')
  })
})

// The bug: staff picked 4 Sept in the Payment Due card and the payment timeline showed
// "3 Sept 2026 · 7:00 pm". A bare "2026-09-04" is UTC midnight, which is the previous
// evening for any viewer west of UTC. These assertions hold in every zone, so they fail
// on a US CI box the same way they fail in Chicago.
const dayOf = (v) => new Date(v).toLocaleDateString('en-CA')

describe('dateInputToISO', () => {
  it('reads back as the picked day, in any browser timezone', () => {
    for (const picked of ['2026-09-04', '2026-01-01', '2026-12-31', '2026-03-08']) {
      expect(dayOf(dateInputToISO(picked))).toBe(picked)
    }
  })

  it('does not send the bare value that caused the off-by-one-day', () => {
    // Whatever the viewer's zone, the instant we send must not be UTC midnight —
    // that is the exact value that renders as the day before west of Greenwich.
    expect(dateInputToISO('2026-09-04')).not.toBe('2026-09-04T00:00:00.000Z')
  })

  it('returns undefined for empty or malformed input so the field is omitted', () => {
    expect(dateInputToISO('')).toBeUndefined()
    expect(dateInputToISO(null)).toBeUndefined()
    expect(dateInputToISO(undefined)).toBeUndefined()
    expect(dateInputToISO('not-a-date')).toBeUndefined()
  })
})

describe('todayDateInput', () => {
  it('gives the viewer-local day as an <input type="date"> value', () => {
    expect(todayDateInput()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(todayDateInput()).toBe(dayOf(new Date()))
  })

  it('round-trips through dateInputToISO to the same day', () => {
    expect(dayOf(dateInputToISO(todayDateInput()))).toBe(todayDateInput())
  })
})
