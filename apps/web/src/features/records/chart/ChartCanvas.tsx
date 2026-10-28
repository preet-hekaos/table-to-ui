import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ChartMeasureResult, ChartPoint } from '@/api/endpoints'
import type { ChartType } from '@/features/studio/features'
import { cn } from '@/design-system'

/** The second series is always this colour; the first follows the workspace accent. */
export const SECOND = '#ea580c'
const PALETTE = ['var(--color-accent)', '#ea580c', '#0891b2', '#7c3aed', '#16a34a', '#db2777', '#ca8a04', '#0d9488', '#64748b']
export const seriesColor = (i: number) => (i === 0 ? 'var(--color-accent)' : SECOND)

export interface CanvasProps {
  type: ChartType
  points: ChartPoint[]
  /** The measures that are switched on, in order. */
  measures: ChartMeasureResult[]
  selected: string | null
  /** Called when a group is clicked; undefined when the table cannot be filtered that way. */
  onPick?: (p: ChartPoint) => void
  fmt: (m: ChartMeasureResult, v: number | null) => string
  xLabel: (p: ChartPoint) => string
}

const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })

/** A scale with round top and five steps, so the grid lines land on clean numbers. */
export function niceMax(max: number) {
  if (max <= 0) return 5
  const pow = 10 ** Math.floor(Math.log10(max))
  const n = max / pow
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return step * pow
}

/** The width of an element, kept up to date as the window or the sidebar changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(720)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setW(Math.max(280, Math.round(el.clientWidth)))
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const smooth = (pts: [number, number][]) => {
  if (pts.length === 0) return ''
  let d = `M${pts[0]![0]},${pts[0]![1]}`
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!]
    const mx = (a[0] + b[0]) / 2
    d += ` C${mx},${a[1]} ${mx},${b[1]} ${b[0]},${b[1]}`
  }
  return d
}

const short = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function ChartCanvas(props: CanvasProps) {
  const { type, points, measures, selected, onPick, fmt, xLabel } = props
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const uid = useId().replace(/:/g, '')
  const active = hover ?? null
  const pick = (p: ChartPoint) => p.key !== '_others' && onPick?.(p)
  const keys = (p: ChartPoint) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(p)
    }
  }
  const describe = (p: ChartPoint) => `${xLabel(p)}: ${measures.map((m) => `${m.label} ${fmt(m, p.values[m.key] ?? null)}`).join(', ')}`

  const m0 = measures[0]
  const m1 = measures[1]

  if (!m0) return <p ref={ref as never} className="px-6 py-10 text-center text-sm text-muted">Turn a measure on to see the chart.</p>

  // ---- horizontal bars ----
  if (type === 'hbar') {
    const rowH = 36
    const max = niceMax(Math.max(0, ...points.map((p) => p.values[m0.key] ?? 0)))
    const labelW = Math.min(170, Math.max(90, width * 0.22))
    const trackW = Math.max(60, width - labelW - 70)
    return (
      <div ref={ref} className="relative px-6 pb-2">
        <svg width="100%" height={points.length * rowH + 12} viewBox={`0 0 ${width - 48} ${points.length * rowH + 12}`} role="group" aria-label="Bars, one per group">
          <defs>
            <linearGradient id={`h${uid}`} x1="0" x2="1">
              <stop offset="0%" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.6 }} />
              <stop offset="100%" style={{ stopColor: 'var(--color-accent)' }} />
            </linearGradient>
          </defs>
          {points.map((p, i) => {
            const v = p.values[m0.key] ?? 0
            const y = 6 + i * rowH
            const w = Math.max(v > 0 ? 6 : 0, (v / max) * trackW)
            const sel = selected === p.key
            const dim = selected !== null && !sel
            return (
              <g
                key={p.key}
                role="button"
                tabIndex={onPick && p.key !== '_others' ? 0 : -1}
                aria-pressed={onPick ? sel : undefined}
                aria-label={describe(p)}
                onClick={() => pick(p)}
                onKeyDown={keys(p)}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                className={cn('outline-none focus-visible:[&>rect:first-child]:stroke-[var(--color-accent)]', onPick && p.key !== '_others' && 'cursor-pointer')}
                opacity={dim ? 0.45 : 1}
              >
                <rect x={0} y={y - 4} width={width - 48} height={rowH - 2} rx={8} fill={active === i ? 'var(--color-soft)' : 'transparent'} stroke="transparent" strokeWidth={2} />
                <text x={8} y={y + 17} fontSize={13} fill="var(--color-body)" fontWeight={sel ? 700 : 400}>{short(xLabel(p), Math.floor(labelW / 7.5))}</text>
                <rect x={labelW} y={y + 3} width={trackW} height={18} rx={9} fill="var(--color-soft)" />
                <rect className="chart-hbar" style={{ animationDelay: `${i * 40}ms` }} x={labelW} y={y + 3} width={w} height={18} rx={9} fill={`url(#h${uid})`} />
                <text x={labelW + trackW + 10} y={y + 17} fontSize={13} fontWeight={700} fill="var(--color-ink)">{fmt(m0, p.values[m0.key] ?? null)}</text>
              </g>
            )
          })}
        </svg>
      </div>
    )
  }

  // ---- donut ----
  if (type === 'donut') {
    const slices = points.filter((p) => (p.values[m0.key] ?? 0) > 0)
    const total = slices.reduce((n, p) => n + (p.values[m0.key] ?? 0), 0)
    const size = 240
    const cx = size / 2
    const r = 104
    const r2 = 68
    const arcs = slices.map((p, i) => {
      const before = slices.slice(0, i).reduce((n, q) => n + (q.values[m0.key] ?? 0), 0)
      const frac = (p.values[m0.key] ?? 0) / total
      const a0 = -Math.PI / 2 + (before / total) * 2 * Math.PI
      const a1 = a0 + frac * 2 * Math.PI - (slices.length > 1 ? 0.03 : 0.0001)
      const pt = (a: number, rr: number) => [cx + rr * Math.cos(a), cx + rr * Math.sin(a)] as const
      const [x0, y0] = pt(a0, r)
      const [x1, y1] = pt(a1, r)
      const [x2, y2] = pt(a1, r2)
      const [x3, y3] = pt(a0, r2)
      const large = a1 - a0 > Math.PI ? 1 : 0
      const d = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r2},${r2} 0 ${large} 0 ${x3},${y3} z`
      return { p, d, frac, color: PALETTE[i % PALETTE.length]!, i }
    })
    return (
      <div ref={ref} className="flex flex-wrap items-center justify-center gap-8 px-6 pb-4">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group" aria-label="Share of each group">
          {arcs.map(({ p, d, color, i }) => {
            const sel = selected === p.key
            const dim = (selected !== null && !sel) || (active !== null && active !== i)
            return (
              <path
                key={p.key}
                d={d}
                fill={color}
                opacity={dim ? 0.35 : 1}
                role="button"
                tabIndex={onPick && p.key !== '_others' ? 0 : -1}
                aria-pressed={onPick ? sel : undefined}
                aria-label={describe(p)}
                className={cn('chart-fade outline-none transition-opacity focus-visible:stroke-[var(--color-ink)] focus-visible:stroke-2', onPick && p.key !== '_others' && 'cursor-pointer')}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => pick(p)}
                onKeyDown={keys(p)}
              />
            )
          })}
          <text x={cx} y={cx + 4} textAnchor="middle" fontSize={28} fontWeight={700} fill="var(--color-ink)">{fmt(m0, total)}</text>
          <text x={cx} y={cx + 24} textAnchor="middle" fontSize={12} fill="var(--color-muted)">{m0.label}</text>
        </svg>
        <ul className="flex min-w-48 flex-col gap-1.5 text-sm" aria-label="Legend">
          {arcs.map(({ p, color, frac, i }) => (
            <li key={p.key} className={cn('flex items-center gap-2 rounded-md px-2 py-1', active === i && 'bg-soft')} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <span className="size-3 shrink-0 rounded" style={{ background: color }} aria-hidden />
              <span className="text-body">{xLabel(p)}</span>
              <span className="ml-auto pl-4 font-semibold text-ink">{fmt(m0, p.values[m0.key] ?? null)}</span>
              <span className="w-10 text-right text-xs text-muted">{Math.round(frac * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  // ---- bars, lines and areas on a grid ----
  const H = 320
  const L = 56
  const R = m1 && type !== 'bar' ? 56 : 24
  const T = 24
  const B = 48
  const pw = Math.max(120, width - 48 - L - R)
  const ph = H - T - B
  const n = Math.max(1, points.length)
  const band = pw / n
  const barsOn = type === 'combo' || type === 'bar'
  const dual = !!m1 && type !== 'bar'
  const max0 = niceMax(Math.max(0, ...points.map((p) => p.values[m0.key] ?? 0)))
  const max1 = m1 ? niceMax(Math.max(0, ...points.map((p) => p.values[m1.key] ?? 0))) : 1
  const sameAxis = type === 'combo' && !m1 // a trend line over the same bars
  const y0 = (v: number) => T + ph - (v / max0) * ph
  const y1 = (v: number) => T + ph - (v / max1) * ph
  const cxOf = (i: number) => L + i * band + band / 2
  const line0 = points.flatMap((p, i) => (p.values[m0.key] == null ? [] : ([[cxOf(i), y0(p.values[m0.key]!)]] as [number, number][])))
  const line1 = m1 ? points.flatMap((p, i) => (p.values[m1.key] == null ? [] : ([[cxOf(i), y1(p.values[m1.key]!)]] as [number, number][]))) : []
  const every = Math.max(1, Math.ceil((n * 62) / pw))
  const bw = Math.min(56, band * 0.62)
  const radius = Math.min(10, bw / 2)
  const showValues = barsOn && band >= 44
  const tipX = active === null ? 0 : cxOf(active)
  const ticks = [0, 1, 2, 3, 4, 5]
  const hp = active === null ? null : points[active]

  const body: ReactNode = (
    <svg width="100%" height={H} viewBox={`0 0 ${width - 48} ${H}`} role="group" aria-label="Chart, one column per group" className="block overflow-visible">
      <defs>
        <linearGradient id={`b${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.85 }} />
          <stop offset="100%" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.45 }} />
        </linearGradient>
        <linearGradient id={`bs${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--color-accent)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.75 }} />
        </linearGradient>
        <linearGradient id={`a${uid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0.4 }} />
          <stop offset="100%" style={{ stopColor: 'var(--color-accent)', stopOpacity: 0 }} />
        </linearGradient>
        <filter id={`g${uid}`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {ticks.map((i) => {
        const y = T + ph - (ph * i) / 5
        return (
          <g key={i}>
            <line x1={L} x2={L + pw} y1={y} y2={y} stroke="var(--color-line)" strokeDasharray="3 5" />
            <text x={L - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)">{compact.format((max0 * i) / 5)}</text>
            {dual && <text x={L + pw + 10} y={y + 4} fontSize={12} fill="var(--color-muted)">{compact.format((max1 * i) / 5)}</text>}
          </g>
        )
      })}
      {active !== null && <rect x={L + active * band + 3} y={T} width={band - 6} height={ph} rx={10} fill="var(--color-soft)" opacity={0.8} />}
      {type === 'area' && line0.length > 1 && (
        <>
          <path className="chart-fade" d={`${smooth(line0)} L${line0[line0.length - 1]![0]},${T + ph} L${line0[0]![0]},${T + ph} z`} fill={`url(#a${uid})`} />
        </>
      )}
      {barsOn &&
        points.map((p, i) => {
          const v = p.values[m0.key]
          if (v == null) return null
          const h = Math.max(v > 0 ? 3 : 0, (v / max0) * ph)
          const x = cxOf(i) - bw / 2
          const y = T + ph - h
          const sel = selected === p.key
          const dim = selected !== null && !sel
          const r = Math.min(radius, h)
          return (
            <g key={p.key} opacity={dim ? 0.4 : 1}>
              <path
                className="chart-bar"
                style={{ animationDelay: `${i * 35}ms` }}
                d={`M${x},${y + h} V${y + r} a${r},${r} 0 0 1 ${r},${-r} h${bw - 2 * r} a${r},${r} 0 0 1 ${r},${r} V${y + h} z`}
                fill={sel || active === i ? `url(#bs${uid})` : `url(#b${uid})`}
              />
              {sel && <rect x={x - 3} y={y - 3} width={bw + 6} height={h + 6} rx={r + 3} fill="none" stroke="var(--color-accent)" strokeWidth={2} />}
              {showValues && (
                <text x={cxOf(i)} y={y - 8} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--color-ink)">{compact.format(v)}</text>
              )}
            </g>
          )
        })}
      {(type === 'line' || type === 'area' ? true : false) && line0.length > 0 && (
        <g>
          <path d={smooth(line0)} fill="none" stroke="var(--color-accent)" strokeWidth={6} opacity={0.2} filter={`url(#g${uid})`} pathLength={1} className="chart-line" />
          <path d={smooth(line0)} fill="none" stroke="var(--color-accent)" strokeWidth={3} strokeLinecap="round" pathLength={1} className="chart-line" />
        </g>
      )}
      {(sameAxis || (type === 'combo' && !!m1)) && (sameAxis ? line0 : line1).length > 0 && (
        <g>
          <path d={smooth(sameAxis ? line0 : line1)} fill="none" stroke={SECOND} strokeWidth={6} opacity={0.22} filter={`url(#g${uid})`} pathLength={1} className="chart-line" />
          <path d={smooth(sameAxis ? line0 : line1)} fill="none" stroke={SECOND} strokeWidth={3} strokeLinecap="round" pathLength={1} className="chart-line" />
        </g>
      )}
      {m1 && (type === 'line' || type === 'area') && line1.length > 0 && (
        <g>
          <path d={smooth(line1)} fill="none" stroke={SECOND} strokeWidth={6} opacity={0.22} filter={`url(#g${uid})`} pathLength={1} className="chart-line" />
          <path d={smooth(line1)} fill="none" stroke={SECOND} strokeWidth={3} strokeLinecap="round" pathLength={1} className="chart-line" />
        </g>
      )}
      {!barsOn &&
        line0.map(([x, y], i) => <circle key={`d0${i}`} className="chart-fade" cx={x} cy={y} r={active !== null && points[active] && x === cxOf(active) ? 7 : 5} fill="var(--color-surface)" stroke="var(--color-accent)" strokeWidth={3} />)}
      {((m1 && (type === 'line' || type === 'area' || type === 'combo')) || sameAxis) &&
        (sameAxis ? line0 : line1).map(([x, y], i) => <circle key={`d1${i}`} className="chart-fade" cx={x} cy={y} r={active !== null && x === cxOf(active) ? 7 : 5} fill="var(--color-surface)" stroke={SECOND} strokeWidth={3} />)}
      {points.map((p, i) => (
        <text key={`x${p.key}`} x={cxOf(i)} y={H - 18} textAnchor="middle" fontSize={13} fontWeight={selected === p.key ? 700 : 400} fill={selected === p.key ? 'var(--color-accent-ink)' : 'var(--color-body)'} display={i % every === 0 ? undefined : 'none'}>
          {short(xLabel(p), Math.max(5, Math.floor(band / 7.5)))}
        </text>
      ))}
      {points.map((p, i) => (
        <rect
          key={`hit${p.key}`}
          x={L + i * band}
          y={T}
          width={band}
          height={ph + B - 8}
          fill="transparent"
          role="button"
          tabIndex={onPick && p.key !== '_others' ? 0 : -1}
          aria-pressed={onPick ? selected === p.key : undefined}
          aria-label={describe(p)}
          className={cn('outline-none focus-visible:stroke-[var(--color-accent)] focus-visible:stroke-2', onPick && p.key !== '_others' && 'cursor-pointer')}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(null)}
          onClick={() => pick(p)}
          onKeyDown={keys(p)}
        />
      ))}
      {active !== null && <line x1={cxOf(active)} x2={cxOf(active)} y1={T} y2={T + ph} stroke="var(--color-accent)" strokeDasharray="4 4" opacity={0.5} pointerEvents="none" />}
    </svg>
  )

  const left = tipX > (width - 48) / 2
  return (
    <div ref={ref} className="relative px-6 pb-2">
      {body}
      {hp && active !== null && (
        <div
          role="presentation"
          className="pointer-events-none absolute z-10 min-w-44 rounded-xl bg-ink px-4 py-3 text-xs text-white shadow-lg"
          style={{ top: T + 8, left: left ? undefined : 24 + tipX + 14, right: left ? width - 24 - tipX + 14 : undefined }}
          data-testid="chart-tip"
        >
          <p className="mb-1.5 text-sm font-bold">{xLabel(hp)}</p>
          {measures.map((m, i) => (
            <p key={m.key} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ background: i === 0 ? 'var(--color-accent)' : SECOND, boxShadow: '0 0 0 2px rgb(255 255 255 / 0.3)' }} aria-hidden />
              <span className="text-slate-300">{m.label}</span>
              <span className="ml-auto pl-3 font-semibold">{fmt(m, hp.values[m.key] ?? null)}</span>
            </p>
          ))}
          {onPick && hp.key !== '_others' && <p className="mt-1.5 text-[11px] text-slate-400">{selected === hp.key ? 'Click to clear the filter' : 'Click to filter the table'}</p>}
        </div>
      )}
    </div>
  )
}
