/**
 * Lines for the table canvas: square-cornered routes, each in its own lane, and a small hop where one line has to cross another.
 *
 * A line leaves the left side of the table that holds the link and arrives at the right side of the table it points at.
 * Pure and deterministic, like the layout, so the same picture always draws the same lines.
 */

import { DEFAULT_SIZE, type LayoutOptions, type Point } from './layout'

export type RouteInput = { id: string; from: string; to: string }
export type Route = {
  id: string
  /** Corner points, from the child's left side to the parent's right side. */
  points: Point[]
  /** x positions on the horizontal runs where this line hops over another, by segment number. */
  hops: Map<number, number[]>
  /** Where a label sits: the middle of the longest run. */
  label: Point
  /** SVG path with rounded corners and the hops. */
  d: string
}

const STUB = 14
const LANE = 12
const HOP = 6
const CORNER = 5

type Seg = { id: string; from: string; a: Point; b: Point }

const vertical = (s: { a: Point; b: Point }) => s.a.x === s.b.x
const horizontal = (s: { a: Point; b: Point }) => s.a.y === s.b.y
const overlaps = (a1: number, a2: number, b1: number, b2: number) => Math.min(a1, a2) < Math.max(b1, b2) && Math.min(b1, b2) < Math.max(a1, a2)

/** The first free x for a vertical run between y1 and y2, trying the middle and then each lane either side. */
function freeX(mid: number, lo: number, hi: number, y1: number, y2: number, taken: Seg[], source: string): number {
  for (let step = 0; step < 40; step++) {
    const off = Math.ceil(step / 2) * LANE * (step % 2 === 1 ? 1 : -1)
    const x = mid + off
    if (x < lo || x > hi) continue
    const clash = taken.some((s) => vertical(s) && s.from !== source && Math.abs(s.a.x - x) < LANE - 1 && overlaps(s.a.y, s.b.y, y1, y2))
    if (!clash) return x
  }
  return mid
}

/** The first free y for a horizontal run between x1 and x2, moving away from `start` a lane at a time. */
function freeY(start: number, dir: 1 | -1, x1: number, x2: number, taken: Seg[], source: string): number {
  for (let step = 0; step < 40; step++) {
    const y = start + dir * step * LANE
    const clash = taken.some((s) => horizontal(s) && s.from !== source && Math.abs(s.a.y - y) < LANE - 1 && overlaps(s.a.x, s.b.x, x1, x2))
    if (!clash) return y
  }
  return start
}

function pathOf(points: Point[], hops: Map<number, number[]>): string {
  const n = points.length
  let d = `M${points[0]!.x},${points[0]!.y}`
  for (let k = 0; k + 1 < n; k++) {
    const a = points[k]!
    const b = points[k + 1]!
    const dx = Math.sign(b.x - a.x)
    const dy = Math.sign(b.y - a.y)
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y)
    const rcStart = k === 0 ? 0 : Math.min(CORNER, len / 2)
    const rcEnd = k + 2 === n ? 0 : Math.min(CORNER, len / 2)
    const start = { x: a.x + dx * rcStart, y: a.y + dy * rcStart }
    const end = { x: b.x - dx * rcEnd, y: b.y - dy * rcEnd }
    if (k > 0) d += ` L${start.x},${start.y}`
    for (const hx of (hops.get(k) ?? []).slice().sort((p, q) => dx * (p - q))) d += ` L${hx - dx * HOP},${a.y} A${HOP},${HOP} 0 0 ${dx > 0 ? 1 : 0} ${hx + dx * HOP},${a.y}`
    d += ` L${end.x},${end.y}`
    if (rcEnd > 0) {
      const c = points[k + 1]!
      const nx = points[k + 2]!
      const ndx = Math.sign(nx.x - c.x)
      const ndy = Math.sign(nx.y - c.y)
      d += ` Q${c.x},${c.y} ${c.x + ndx * rcEnd},${c.y + ndy * rcEnd}`
    }
  }
  return d
}

/**
 * Route every link. Lines are placed one after another, longest last, and each takes the first lane that does not run
 * along another table's line. Lines that leave the same table may share a lane: they are one colour and read as a trunk.
 */
export function routeLinks(inputs: RouteInput[], pos: Record<string, Point>, size: LayoutOptions = DEFAULT_SIZE): Map<string, Route> {
  const taken: Seg[] = []
  const routes = new Map<string, Route>()
  const ordered = inputs
    .filter((e) => pos[e.from] && pos[e.to] && e.from !== e.to)
    .map((e) => ({ e, span: Math.abs(pos[e.from]!.x - pos[e.to]!.x) + Math.abs(pos[e.from]!.y - pos[e.to]!.y) }))
    .sort((p, q) => p.span - q.span || p.e.id.localeCompare(q.e.id))
  for (const { e } of ordered) {
    const f = pos[e.from]!
    const t = pos[e.to]!
    const S = { x: f.x, y: f.y + size.height / 2 }
    const T = { x: t.x + size.width, y: t.y + size.height / 2 }
    const A = { x: S.x - STUB, y: S.y }
    const B = { x: T.x + STUB, y: T.y }
    let pts: Point[]
    if (A.x > B.x) {
      // The parent sits clearly to the left: out, across in a free lane, in.
      const x = freeX(Math.round((A.x + B.x) / 2), B.x, A.x, S.y, T.y, taken, e.from)
      pts = [S, { x, y: S.y }, { x, y: T.y }, T]
    } else {
      // Level with or beside it: out, round above or below both cards, in.
      const up = Math.min(f.y, t.y) - 22
      const down = Math.max(f.y, t.y) + size.height + 22
      const goUp = Math.abs(S.y - up) + Math.abs(T.y - up) <= Math.abs(S.y - down) + Math.abs(T.y - down)
      const y = goUp ? freeY(up, -1, B.x, A.x, taken, e.from) : freeY(down, 1, B.x, A.x, taken, e.from)
      pts = [S, A, { x: A.x, y }, { x: B.x, y }, B, T]
    }
    pts = pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y)
    for (let i = 0; i + 1 < pts.length; i++) taken.push({ id: e.id, from: e.from, a: pts[i]!, b: pts[i + 1]! })
    routes.set(e.id, { id: e.id, points: pts, hops: new Map(), label: { x: 0, y: 0 }, d: '' })
  }

  // Where a horizontal run crosses another table's vertical run, it hops over.
  const bySource = new Map(inputs.map((i) => [i.id, i.from]))
  for (const r of routes.values()) {
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k]!
      const b = r.points[k + 1]!
      if (a.y !== b.y) continue
      const xs: number[] = []
      for (const o of routes.values()) {
        if (o.id === r.id || bySource.get(o.id) === bySource.get(r.id)) continue
        for (let j = 0; j + 1 < o.points.length; j++) {
          const p = o.points[j]!
          const q = o.points[j + 1]!
          if (p.x !== q.x) continue
          const lo = Math.min(a.x, b.x)
          const hi = Math.max(a.x, b.x)
          const clearOfEnds = p.x > lo + HOP + CORNER && p.x < hi - HOP - CORNER
          if (clearOfEnds && a.y > Math.min(p.y, q.y) + CORNER && a.y < Math.max(p.y, q.y) - CORNER) xs.push(p.x)
        }
      }
      // Two hops closer than one hop wide would touch, so keep one of them.
      const keep = [...new Set(xs)].sort((p, q) => p - q).filter((x, i, all) => i === 0 || x - all[i - 1]! > HOP * 2 + 2)
      if (keep.length) r.hops.set(k, keep)
    }
    let best = 0
    r.label = r.points[0]!
    for (let k = 0; k + 1 < r.points.length; k++) {
      const a = r.points[k]!
      const b = r.points[k + 1]!
      const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
      if (len > best) {
        best = len
        r.label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      }
    }
    r.d = pathOf(r.points, r.hops)
  }
  return routes
}

/** How many hops the whole picture needs; a measure of how tangled it is. */
export const hopCount = (routes: Map<string, Route>) => [...routes.values()].reduce((n, r) => n + [...r.hops.values()].reduce((m, xs) => m + xs.length, 0), 0)
