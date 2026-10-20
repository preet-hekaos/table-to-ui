/** Shades of an agency's accent colour for the app frame. The server already checked that white
 *  text on the accent meets 4.5:1; the ink shade is darkened until it meets 4.5:1 on the soft shade. */
type RGB = [number, number, number]

const hex = (h: string): RGB => {
  const v = h.replace('#', '')
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as RGB
}
const toHex = (c: RGB) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const lum = (c: RGB) => {
  const [r, g, b] = c.map((x) => {
    const s = x / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as RGB
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrast = (a: string, b: string) => {
  const [l1, l2] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x) as [number, number]
  return (l1 + 0.05) / (l2 + 0.05)
}

export function accentShades(accent: string): Record<string, string> | null {
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent)) return null
  const base = hex(accent)
  const black: RGB = [0, 0, 0]
  const white: RGB = [255, 255, 255]
  const soft = toHex(mix(base, white, 0.88))
  let ink = toHex(mix(base, black, 0.35))
  for (let t = 0.35; contrast(ink, soft) < 4.5 && t < 0.95; t += 0.05) ink = toHex(mix(base, black, t))
  return {
    '--agency-accent': toHex(base),
    '--agency-accent-strong': toHex(mix(base, black, 0.15)),
    '--agency-accent-soft': soft,
    '--agency-accent-ink': ink,
  }
}
