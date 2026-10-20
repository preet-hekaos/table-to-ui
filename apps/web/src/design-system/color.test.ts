import { describe, expect, it } from 'vitest'
import { accentShades, contrast } from './color'

describe('accent shades', () => {
  it('keeps ink readable on the soft shade', () => {
    for (const c of ['#1d4ed8', '#0f766e', '#7c3aed', '#b91c1c', '#ca8a04']) {
      const s = accentShades(c)!
      expect(contrast(s['--agency-accent-ink']!, s['--agency-accent-soft']!)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('rejects anything that is not a colour', () => {
    expect(accentShades('red; background: url(x)')).toBeNull()
  })
})
