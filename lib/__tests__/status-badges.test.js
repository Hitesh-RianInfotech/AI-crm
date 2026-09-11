import { describe, it, expect } from 'vitest'
import { sanitizeStatusHex } from '../status-hex'
import {
  getLeadStageColor,
  getLeadStageBadgeProps,
  formatLeadStageLabel,
} from '../lead-stages'
import {
  customerLifecycleColor,
  getCustomerLifecycleBadgeProps,
  customerLifecycleLabel,
} from '../customer-lifecycle'

describe('sanitizeStatusHex', () => {
  it('keeps 6-digit hex and expands 3-digit hex', () => {
    expect(sanitizeStatusHex('#D97706')).toBe('#D97706')
    expect(sanitizeStatusHex('#abc')).toBe('#aabbcc')
  })

  it('rejects empty or non-hex values', () => {
    expect(sanitizeStatusHex('')).toBe('')
    expect(sanitizeStatusHex('orange')).toBe('')
    expect(sanitizeStatusHex('#zzzzzz')).toBe('')
    expect(sanitizeStatusHex(null)).toBe('')
  })
})

describe('getLeadStageColor / getLeadStageBadgeProps', () => {
  it('uses the org color from Stages & Lifecycle when present', () => {
    const stages = [{ key: 'human intervention', color: '#FF00AA', name: 'Needs Human' }]
    expect(getLeadStageColor('human intervention', stages)).toBe('#FF00AA')
    expect(getLeadStageBadgeProps('human intervention', stages)).toEqual({
      className: 'status-color-badge',
      style: { '--status-color': '#FF00AA' },
    })
  })

  it('falls back to the seeded hex when the org list has no color', () => {
    expect(getLeadStageColor('human intervention', [])).toBe('#D97706')
    expect(getLeadStageColor('engaged')).toBe('#3B82F6')
  })

  it('ignores invalid stored colors and uses the seeded hex', () => {
    const stages = [{ key: 'engaged', color: 'not-a-color' }]
    expect(getLeadStageColor('engaged', stages)).toBe('#3B82F6')
  })

  it('uses a class fallback for unknown legacy keys', () => {
    const props = getLeadStageBadgeProps('actualized', [])
    expect(props.className).toContain('bg-muted')
    expect(props.style).toBeUndefined()
  })

  it('still title-cases labels and prefers the org name', () => {
    expect(formatLeadStageLabel('human intervention')).toBe('Human Intervention')
    expect(
      formatLeadStageLabel('human intervention', [
        { key: 'human intervention', name: 'Needs Human' },
      ])
    ).toBe('Needs Human')
  })
})

describe('customer lifecycle colors', () => {
  it('uses the same hex shown on Stages & Lifecycle', () => {
    expect(customerLifecycleColor('trial_no_show')).toBe('#F97316')
    expect(customerLifecycleColor('active')).toBe('#059669')
    expect(getCustomerLifecycleBadgeProps('inactive')).toEqual({
      className: 'status-color-badge',
      style: { '--status-color': '#E11D48' },
    })
  })

  it('defaults missing status to Active, matching the previous badge default', () => {
    expect(customerLifecycleColor('')).toBe('#059669')
    expect(customerLifecycleLabel('trial_scheduled')).toBe('Trial Scheduled')
  })
})
