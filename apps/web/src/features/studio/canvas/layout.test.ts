import { describe, expect, it } from 'vitest'
import pack from './pack-model.json'
import { countCrossings, countOverlaps, gridLayout, layeredLayout, type LayoutEdge } from './layout'

/** A repeatable pseudo-random model that looks like a real business: parents first, children refer back. */
function generated(tables: number, links: number): { keys: string[]; edges: LayoutEdge[] } {
  let seed = 7
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
  const keys = Array.from({ length: tables }, (_, i) => `t${String(i).padStart(2, '0')}`)
  const edges: LayoutEdge[] = []
  while (edges.length < links) {
    const child = 1 + Math.floor(rnd() * (tables - 1))
    const parent = Math.floor(rnd() * child)
    if (!edges.some((e) => e.from === keys[child] && e.to === keys[parent])) edges.push({ from: keys[child]!, to: keys[parent]! })
  }
  return { keys, edges }
}

describe('layered layout', () => {
  it('is deterministic and puts every table somewhere without overlap', () => {
    const { keys, edges } = generated(40, 100)
    const a = layeredLayout(keys, edges)
    expect(layeredLayout(keys, edges)).toEqual(a)
    expect(Object.keys(a).sort()).toEqual(keys)
    expect(countOverlaps(a)).toBe(0)
  })

  it('puts parents to the left of their children', () => {
    const pos = layeredLayout(['client', 'contact', 'requirement'], [
      { from: 'contact', to: 'client' },
      { from: 'requirement', to: 'contact' },
    ])
    expect(pos.client!.x).toBeLessThan(pos.contact!.x)
    expect(pos.contact!.x).toBeLessThan(pos.requirement!.x)
  })

  it('survives a loop, a self-link, a link to an unknown table and a table with no links', () => {
    const pos = layeredLayout(['a', 'b', 'c', 'lonely'], [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
      { from: 'c', to: 'c' },
      { from: 'c', to: 'ghost' },
    ])
    expect(Object.keys(pos).sort()).toEqual(['a', 'b', 'c', 'lonely'])
    expect(countOverlaps(pos)).toBe(0)
  })

  it('handles no tables and no links', () => {
    expect(layeredLayout([], [])).toEqual({})
    expect(Object.keys(layeredLayout(['x', 'y'], []))).toEqual(['x', 'y'])
  })

  it('crosses fewer lines than the old grid on the recruitment pack (13 tables, 18 links)', () => {
    const edges = pack.links
    const before = countCrossings(gridLayout(pack.tables, edges), edges)
    const after = countCrossings(layeredLayout(pack.tables, edges), edges)
    expect(after).toBeLessThan(before)
    expect(after).toBeLessThanOrEqual(6)
  })

  it('stays clear on a 40-table, 100-link model: far fewer crossings than the grid', () => {
    const { keys, edges } = generated(40, 100)
    const before = countCrossings(gridLayout(keys, edges), edges)
    const after = countCrossings(layeredLayout(keys, edges), edges)
    expect(after).toBeLessThan(before * 0.5)
  })
})
