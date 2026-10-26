/**
 * Layered layout for the table canvas.
 *
 * A link goes from the table that holds the reference (the child) to the table it points at (the
 * parent). Parents are placed to the left of their children, in columns ("layers"), and the tables
 * inside each column are ordered to keep lines from crossing. Pure and deterministic: the same
 * tables and links always give the same picture, so the canvas does not jump around.
 */

export type LayoutEdge = { from: string; to: string }
export type Point = { x: number; y: number }
export type LayoutOptions = { width: number; height: number; gapX: number; gapY: number }

export const DEFAULT_SIZE: LayoutOptions = { width: 176, height: 64, gapX: 96, gapY: 24 }

const unique = (edges: LayoutEdge[], known: Set<string>): LayoutEdge[] => {
  const seen = new Set<string>()
  const out: LayoutEdge[] = []
  for (const e of edges) {
    if (e.from === e.to || !known.has(e.from) || !known.has(e.to)) continue
    const k = `${e.from}\u0000${e.to}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push(e)
  }
  return out
}

/** Parent -> child pairs with cycles removed (the edge that closes a loop is turned round). */
function acyclic(keys: string[], edges: LayoutEdge[]): [string, string][] {
  const children = new Map<string, string[]>(keys.map((k) => [k, []]))
  for (const e of edges) children.get(e.to)!.push(e.from)
  for (const list of children.values()) list.sort()
  const state = new Map<string, 0 | 1 | 2>()
  const back = new Set<string>()
  const visit = (n: string) => {
    state.set(n, 1)
    for (const c of children.get(n)!) {
      const s = state.get(c) ?? 0
      if (s === 1) back.add(`${n}\u0000${c}`)
      else if (s === 0) visit(c)
    }
    state.set(n, 2)
  }
  for (const k of keys) if (!state.has(k)) visit(k)
  return edges.map((e) => (back.has(`${e.to}\u0000${e.from}`) ? ([e.from, e.to] as [string, string]) : ([e.to, e.from] as [string, string])))
}

/** Column of every table: one to the right of its right-most parent. */
function layering(keys: string[], pc: [string, string][]): Map<string, number> {
  const parents = new Map<string, string[]>(keys.map((k) => [k, []]))
  const kids = new Map<string, string[]>(keys.map((k) => [k, []]))
  for (const [p, c] of pc) {
    parents.get(c)!.push(p)
    kids.get(p)!.push(c)
  }
  const layer = new Map<string, number>()
  const waiting = new Map(keys.map((k) => [k, parents.get(k)!.length]))
  const queue = keys.filter((k) => waiting.get(k) === 0).sort()
  for (const k of queue) layer.set(k, 0)
  while (queue.length) {
    const n = queue.shift()!
    for (const c of kids.get(n)!.slice().sort()) {
      layer.set(c, Math.max(layer.get(c) ?? 0, layer.get(n)! + 1))
      waiting.set(c, waiting.get(c)! - 1)
      if (waiting.get(c) === 0) queue.push(c)
    }
  }
  return layer
}

type Slot = { id: string; dummy: boolean }

/** Number of crossings between neighbouring columns for the given order. */
function crossingsOf(columns: Slot[][], links: [string, string][]): number {
  let total = 0
  for (let i = 0; i + 1 < columns.length; i++) {
    const pos = new Map(columns[i + 1]!.map((s, j) => [s.id, j]))
    const left = new Map(columns[i]!.map((s, j) => [s.id, j]))
    const pairs = links
      .filter(([a, b]) => left.has(a) && pos.has(b))
      .map(([a, b]) => [left.get(a)!, pos.get(b)!] as const)
      .sort((p, q) => p[0] - q[0] || p[1] - q[1])
    for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) if (pairs[a]![0] < pairs[b]![0] && pairs[a]![1] > pairs[b]![1]) total++
  }
  return total
}

export function layeredLayout(keys: string[], rawEdges: LayoutEdge[], size: LayoutOptions = DEFAULT_SIZE): Record<string, Point> {
  const sorted = [...keys].sort()
  const known = new Set(sorted)
  const edges = unique(rawEdges, known)
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]))
  const connected = sorted.filter((k) => linked.has(k))
  const loose = sorted.filter((k) => !linked.has(k))
  const out: Record<string, Point> = {}
  const stepX = size.width + size.gapX
  const stepY = size.height + size.gapY

  let bottom = 0
  if (connected.length) {
    const pc = acyclic(connected, edges)
    const layer = layering(connected, pc)
    const depth = Math.max(...layer.values()) + 1

    // Long links get a stand-in slot in each column they pass, so ordering makes room for them.
    const columns: Slot[][] = Array.from({ length: depth }, () => [])
    for (const k of connected) columns[layer.get(k)!]!.push({ id: k, dummy: false })
    const hops: [string, string][] = []
    pc.forEach(([p, c], n) => {
      let prev = p
      for (let l = layer.get(p)! + 1; l < layer.get(c)!; l++) {
        const id = `~${n}:${l}`
        columns[l]!.push({ id, dummy: true })
        hops.push([prev, id])
        prev = id
      }
      hops.push([prev, c])
    })

    const neighbours = (id: string, dir: 'left' | 'right') =>
      hops.filter(([a, b]) => (dir === 'left' ? b === id : a === id)).map(([a, b]) => (dir === 'left' ? a : b))
    let best = columns.map((c) => c.slice())
    let bestScore = crossingsOf(best, hops)
    const index = (cols: Slot[][]) => new Map(cols.flatMap((c) => c.map((s, j) => [s.id, j] as const)))
    for (let sweep = 0; sweep < 24 && bestScore > 0; sweep++) {
      const down = sweep % 2 === 0
      const order = down ? columns.map((_, i) => i).slice(1) : columns.map((_, i) => i).slice(0, -1).reverse()
      for (const i of order) {
        const ref = index(columns)
        const dir = down ? 'left' : 'right'
        const score = new Map(
          columns[i]!.map((s, j) => {
            const ns = neighbours(s.id, dir).map((n) => ref.get(n)!).filter((v) => v !== undefined)
            return [s.id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : j] as const
          }),
        )
        columns[i]!.sort((a, b) => score.get(a.id)! - score.get(b.id)! || a.id.localeCompare(b.id))
      }
      const now = crossingsOf(columns, hops)
      if (now < bestScore) {
        bestScore = now
        best = columns.map((c) => c.slice())
      }
    }

    // Vertical place: stack in order, then pull each column toward its neighbours while keeping the gaps.
    const y = new Map<string, number>()
    best.forEach((col) => col.forEach((s, j) => y.set(s.id, j * stepY)))
    for (let pass = 0; pass < 6; pass++) {
      const cols = pass % 2 === 0 ? best.map((_, i) => i) : best.map((_, i) => i).reverse()
      for (const i of cols) {
        const col = best[i]!
        const want = col.map((s) => {
          const ns = [...neighbours(s.id, 'left'), ...neighbours(s.id, 'right')].map((n) => y.get(n)!)
          return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : y.get(s.id)!
        })
        const placed: number[] = []
        want.forEach((w, j) => placed.push(Math.max(w, j === 0 ? -Infinity : placed[j - 1]! + stepY)))
        for (let j = want.length - 2; j >= 0; j--) placed[j] = Math.min(placed[j]!, placed[j + 1]! - stepY)
        const shift = want.reduce((a, w, j) => a + (w - placed[j]!), 0) / want.length
        col.forEach((s, j) => y.set(s.id, placed[j]! + shift))
      }
    }
    const top = Math.min(...[...y.values()])
    for (const k of connected) out[k] = { x: layer.get(k)! * stepX, y: y.get(k)! - top }
    bottom = Math.max(...connected.map((k) => out[k]!.y)) + stepY
  }

  // Tables with no links sit in a tidy block underneath.
  const perRow = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(loose.length))))
  loose.forEach((k, i) => {
    out[k] = { x: (i % perRow) * stepX, y: bottom + (connected.length ? stepY : 0) + Math.floor(i / perRow) * stepY }
  })
  return out
}

/** Old placement, kept only so tests can show the new one is better: a plain grid, most-linked first. */
export function gridLayout(keys: string[], edges: LayoutEdge[], size: LayoutOptions = DEFAULT_SIZE): Record<string, Point> {
  const degree = (k: string) => edges.filter((e) => e.from === k || e.to === k).length
  const ordered = [...keys].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b))
  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.3)))
  return Object.fromEntries(ordered.map((k, i) => [k, { x: (i % cols) * (size.width + size.gapX), y: Math.floor(i / cols) * (size.height + size.gapY) }]))
}

const orient = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))

/** Straight lines from the left edge of the child card to the right edge of the parent card that cross. */
export function countCrossings(pos: Record<string, Point>, rawEdges: LayoutEdge[], size: LayoutOptions = DEFAULT_SIZE): number {
  const edges = unique(rawEdges, new Set(Object.keys(pos)))
  const seg = edges.map((e) => ({ e, a: { x: pos[e.from]!.x, y: pos[e.from]!.y + size.height / 2 }, b: { x: pos[e.to]!.x + size.width, y: pos[e.to]!.y + size.height / 2 } }))
  let n = 0
  for (let i = 0; i < seg.length; i++)
    for (let j = i + 1; j < seg.length; j++) {
      const p = seg[i]!
      const q = seg[j]!
      if (p.e.from === q.e.from || p.e.to === q.e.to || p.e.from === q.e.to || p.e.to === q.e.from) continue
      if (orient(p.a, p.b, q.a) !== orient(p.a, p.b, q.b) && orient(q.a, q.b, p.a) !== orient(q.a, q.b, p.b)) n++
    }
  return n
}

/** Cards that overlap each other (should always be zero). */
export function countOverlaps(pos: Record<string, Point>, size: LayoutOptions = DEFAULT_SIZE): number {
  const p = Object.values(pos)
  let n = 0
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) if (Math.abs(p[i]!.x - p[j]!.x) < size.width && Math.abs(p[i]!.y - p[j]!.y) < size.height) n++
  return n
}
