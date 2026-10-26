import { describe, expect, it } from 'vitest'
import { forceLayout, FORCE_DEFAULTS } from './force'
import pack from './pack-model.json'

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('force layout', () => {
  it('is deterministic and places every table', () => {
    const a = forceLayout(pack.tables, pack.links)
    expect(forceLayout(pack.tables, pack.links)).toEqual(a)
    expect(Object.keys(a).sort()).toEqual([...pack.tables].sort())
  })

  it('never lets two tables sit closer than the minimum gap', () => {
    const p = forceLayout(pack.tables, pack.links)
    const all = Object.values(p)
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(dist(all[i]!, all[j]!)).toBeGreaterThanOrEqual(FORCE_DEFAULTS.minGap - 1)
  })

  it('draws linked tables closer together than unlinked ones, on average', () => {
    const p = forceLayout(pack.tables, pack.links)
    const linked = new Set(pack.links.map((l) => [l.from, l.to].sort().join('|')))
    const near: number[] = []
    const far: number[] = []
    const keys = Object.keys(p)
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) (linked.has([keys[i]!, keys[j]!].sort().join('|')) ? near : far).push(dist(p[keys[i]!]!, p[keys[j]!]!))
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(near)).toBeLessThan(mean(far))
  })

  it('copes with no tables, one table, a self-link and links to tables that are not there', () => {
    expect(forceLayout([], [])).toEqual({})
    expect(Object.keys(forceLayout(['a'], [{ from: 'a', to: 'a' }, { from: 'a', to: 'ghost' }]))).toEqual(['a'])
  })
})
