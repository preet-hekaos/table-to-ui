import { describe, expect, it } from 'vitest'
import { DEFAULT_FEATURES, featuresOf } from './features'

describe('featuresOf', () => {
  it('has every feature on for a table that was never customised', () => {
    expect(featuresOf({})).toEqual(DEFAULT_FEATURES)
    expect(featuresOf(null)).toEqual(DEFAULT_FEATURES)
    expect(featuresOf({ features: null })).toEqual(DEFAULT_FEATURES)
  })
  it('keeps what the owner changed and fills the rest with the defaults', () => {
    const f = featuresOf({ features: { grouping: false } as never })
    expect(f.grouping).toBe(false)
    expect(f.sort_filter).toBe(true)
    expect(f.bulk_actions).toEqual(['export', 'edit', 'delete'])
  })
})
