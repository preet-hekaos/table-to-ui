import { describe, expect, it } from 'vitest'
import { layeredLayout } from './layout'
import { hopCount, routeLinks } from './route'

const pos = { a: { x: 0, y: 0 }, b: { x: 0, y: 120 }, c: { x: 400, y: 0 }, d: { x: 400, y: 120 } }

describe('routeLinks', () => {
  it('runs from the left side of the child to the right side of the parent, in square corners', () => {
    const r = routeLinks([{ id: '1', from: 'c', to: 'a' }], pos).get('1')!
    expect(r.points[0]).toEqual({ x: 400, y: 32 })
    expect(r.points.at(-1)).toEqual({ x: 176, y: 32 })
    for (let i = 0; i + 1 < r.points.length; i++) expect(r.points[i]!.x === r.points[i + 1]!.x || r.points[i]!.y === r.points[i + 1]!.y).toBe(true)
    expect(r.d.startsWith('M400,32')).toBe(true)
  })

  it('hops where two lines of different tables cross, and only once per crossing', () => {
    const routes = routeLinks(
      [
        { id: 'x', from: 'c', to: 'b' }, // goes down-left
        { id: 'y', from: 'd', to: 'a' }, // goes up-left, so they cross
      ],
      { ...pos, c: { x: 400, y: 50 }, d: { x: 400, y: 170 } },
    )
    expect(hopCount(routes)).toBe(1)
    expect([...routes.values()].filter((r) => r.d.includes(' A')).length).toBe(1)
  })

  it('does not hop between lines that leave the same table, they are one trunk', () => {
    const routes = routeLinks(
      [
        { id: 'x', from: 'c', to: 'a' },
        { id: 'y', from: 'c', to: 'b' },
      ],
      pos,
    )
    expect(hopCount(routes)).toBe(0)
  })

  it('gives lines of different tables their own lane instead of running on top of each other', () => {
    const routes = routeLinks(
      [
        { id: 'x', from: 'c', to: 'a' },
        { id: 'y', from: 'd', to: 'a' },
        { id: 'z', from: 'c', to: 'b' },
      ],
      pos,
    )
    const lanes = ['x', 'y'].map((id) => routes.get(id)!.points.find((p, i, all) => i > 0 && p.x === all[i - 1]!.x)?.x)
    expect(lanes[0]).not.toBe(lanes[1])
  })

  it('goes round when the parent is not to the left', () => {
    const r = routeLinks([{ id: '1', from: 'a', to: 'c' }], pos).get('1')!
    expect(r.points.length).toBeGreaterThanOrEqual(5)
    expect(new Set(r.points.map((p) => p.y)).size).toBeGreaterThan(1)
  })

  it('is the same every time', () => {
    const keys = ['a', 'b', 'c', 'd']
    const edges = [{ from: 'b', to: 'a' }, { from: 'c', to: 'a' }, { from: 'd', to: 'b' }, { from: 'd', to: 'a' }]
    const p = layeredLayout(keys, edges)
    const inputs = edges.map((e, i) => ({ id: String(i), ...e }))
    const one = [...routeLinks(inputs, p).values()].map((r) => r.d)
    const two = [...routeLinks(inputs, p).values()].map((r) => r.d)
    expect(one).toEqual(two)
  })
})
