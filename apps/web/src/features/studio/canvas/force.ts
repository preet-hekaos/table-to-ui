/**
 * Force layout for the graph view: linked tables pull together, every table pushes the others
 * away, and the whole picture is drawn toward the middle. Pure and deterministic (no random
 * numbers): the starting positions are a ring in name order, so the same tables always settle
 * into the same picture.
 */
import type { LayoutEdge, Point } from './layout'

export type ForceOptions = { iterations: number; spring: number; repulsion: number; gravity: number; minGap: number }
export const FORCE_DEFAULTS: ForceOptions = { iterations: 320, spring: 150, repulsion: 26000, gravity: 0.012, minGap: 90 }

export function forceLayout(keys: string[], rawEdges: LayoutEdge[], o: ForceOptions = FORCE_DEFAULTS): Record<string, Point> {
  const sorted = [...keys].sort()
  const n = sorted.length
  if (n === 0) return {}
  const index = new Map(sorted.map((k, i) => [k, i]))
  const seen = new Set<string>()
  const edges: [number, number][] = []
  for (const e of rawEdges) {
    const a = index.get(e.from)
    const b = index.get(e.to)
    if (a === undefined || b === undefined || a === b) continue
    const k = a < b ? `${a}-${b}` : `${b}-${a}`
    if (seen.has(k)) continue
    seen.add(k)
    edges.push([a, b])
  }
  const radius = Math.max(120, n * 28)
  const px = sorted.map((_, i) => radius * Math.cos((2 * Math.PI * i) / n))
  const py = sorted.map((_, i) => radius * Math.sin((2 * Math.PI * i) / n))
  for (let step = 0; step < o.iterations; step++) {
    const cool = 1 - step / o.iterations
    const fx = new Array<number>(n).fill(0)
    const fy = new Array<number>(n).fill(0)
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        let dx = px[i]! - px[j]!
        let dy = py[i]! - py[j]!
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          dx = (i - j) * 0.1
          dy = 0.1
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const f = o.repulsion / d2
        fx[i] = fx[i]! + (dx / d) * f
        fy[i] = fy[i]! + (dy / d) * f
        fx[j] = fx[j]! - (dx / d) * f
        fy[j] = fy[j]! - (dy / d) * f
      }
    for (const [a, b] of edges) {
      const dx = px[b]! - px[a]!
      const dy = py[b]! - py[a]!
      const d = Math.sqrt(dx * dx + dy * dy) || 1
      const f = ((d - o.spring) * 0.06)
      fx[a] = fx[a]! + (dx / d) * f
      fy[a] = fy[a]! + (dy / d) * f
      fx[b] = fx[b]! - (dx / d) * f
      fy[b] = fy[b]! - (dy / d) * f
    }
    for (let i = 0; i < n; i++) {
      fx[i] = fx[i]! - px[i]! * o.gravity
      fy[i] = fy[i]! - py[i]! * o.gravity
      const len = Math.sqrt(fx[i]! ** 2 + fy[i]! ** 2) || 1
      const move = Math.min(len, 40) * cool
      px[i] = px[i]! + (fx[i]! / len) * move
      py[i] = py[i]! + (fy[i]! / len) * move
    }
  }
  // Push apart anything still closer than the minimum gap, so dots and names never sit on each other.
  for (let pass = 0; pass < 40; pass++) {
    let moved = false
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const dx = px[i]! - px[j]!
        const dy = py[i]! - py[j]!
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01
        if (d < o.minGap) {
          const s = (o.minGap - d) / 2
          const ux = d < 0.02 ? 1 : dx / d
          const uy = d < 0.02 ? 0 : dy / d
          px[i] = px[i]! + ux * s
          py[i] = py[i]! + uy * s
          px[j] = px[j]! - ux * s
          py[j] = py[j]! - uy * s
          moved = true
        }
      }
    if (!moved) break
  }
  return Object.fromEntries(sorted.map((k, i) => [k, { x: Math.round(px[i]! * 10) / 10, y: Math.round(py[i]! * 10) / 10 }]))
}
