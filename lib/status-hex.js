const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** Accept only real CSS hex so a bad API value cannot break badge styles. */
export function sanitizeStatusHex(value) {
  const color = String(value || '').trim()
  if (!HEX_RE.test(color)) return ''
  if (color.length === 4) {
    const r = color[1]
    const g = color[2]
    const b = color[3]
    return `#${r}${r}${g}${g}${b}${b}`
  }
  return color
}
