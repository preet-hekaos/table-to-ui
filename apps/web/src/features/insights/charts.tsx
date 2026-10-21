import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import type { MeasurePoint } from '@/api/types'
import { Button, Table, Td, Th } from '@/design-system'

export interface DrillLink {
  to: '/insights/$key'
  params: { key: string }
  search: { range?: string; start?: string; end?: string; group?: string; bucket?: string }
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? 'No data' : v.toLocaleString('en-IN'))
const dateLabel = (iso: string, unit?: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return unit === 'month'
    ? d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** A line over time. Always has a table view, so nobody has to read values off a picture. */
export function TrendChart({ label, series, unit, drill }: { label: string; series: MeasurePoint[]; unit?: string; drill?: (bucket: string) => DrillLink }) {
  const [table, setTable] = useState(false)
  const w = 320
  const h = 120
  const max = Math.max(1, ...series.map((p) => p.value ?? 0))
  const x = (i: number) => (series.length < 2 ? w / 2 : 8 + (i * (w - 16)) / (series.length - 1))
  const y = (v: number) => h - 14 - (v / max) * (h - 28)
  const pts = series.map((p, i) => `${x(i)},${y(p.value ?? 0)}`).join(' ')
  const total = series.reduce((n, p) => n + (p.value ?? 0), 0)
  const summary = `${label}: ${fmt(total)} in total over ${series.length} ${unit ?? 'period'}s. Highest ${fmt(max)}.`
  return (
    <div className="flex flex-col gap-2">
      {table ? (
        <Table aria-label={`${label} by ${unit ?? 'period'}`}>
          <thead>
            <tr>
              <Th>{unit === 'month' ? 'Month' : unit === 'week' ? 'Week starting' : 'Day'}</Th>
              <Th className="text-right">Value</Th>
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.label} className="border-b border-line last:border-0">
                <Td>{dateLabel(p.label, unit)}</Td>
                <Td className="text-right tabular-nums">
                  {drill && (p.value ?? 0) > 0 ? (
                    <Link {...drill(p.label)} className="font-semibold text-accent-ink underline">{fmt(p.value)}</Link>
                  ) : (
                    fmt(p.value)
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={summary} className="w-full text-accent">
          <line x1="8" x2={w - 8} y1={h - 14} y2={h - 14} className="stroke-line" strokeWidth="1" />
          <polyline points={`${x(0)},${h - 14} ${pts} ${x(series.length - 1)},${h - 14}`} fill="currentColor" opacity="0.12" />
          <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          {series.map((p, i) => (
            <circle key={p.label} cx={x(i)} cy={y(p.value ?? 0)} r="2.5" fill="currentColor" />
          ))}
          <text x="8" y={h - 2} className="fill-muted text-[9px]">{series[0] ? dateLabel(series[0].label, unit) : ''}</text>
          <text x={w - 8} y={h - 2} textAnchor="end" className="fill-muted text-[9px]">{series.length ? dateLabel(series[series.length - 1]!.label, unit) : ''}</text>
          <text x="8" y="10" className="fill-muted text-[9px]">{fmt(max)}</text>
        </svg>
      )}
      <Button size="sm" variant="ghost" className="self-start" onClick={() => setTable((t) => !t)} aria-pressed={table}>
        {table ? 'Show chart' : 'Show as table'}
      </Button>
    </div>
  )
}

/** One bar per value. Each bar is a link to the records behind it. */
export function BarsChart({ label, series, drill }: { label: string; series: MeasurePoint[]; drill?: (key: string) => DrillLink }) {
  const max = Math.max(1, ...series.map((p) => p.value ?? 0))
  return (
    <ul className="flex flex-col gap-1.5" aria-label={label}>
      {series.map((p) => {
        const pct = ((p.value ?? 0) / max) * 100
        const inner = (
          <>
            <span className="w-32 shrink-0 truncate text-xs text-ink">{p.label}</span>
            <span className="h-3 flex-1 rounded-sm bg-canvas" aria-hidden>
              <span className="block h-3 rounded-sm bg-accent" style={{ width: `${pct}%` }} />
            </span>
            <span className="w-10 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{fmt(p.value)}</span>
          </>
        )
        return (
          <li key={p.key ?? p.label}>
            {drill && (p.value ?? 0) > 0 ? (
              <Link {...drill(p.key ?? '')} className="flex min-h-6 items-center gap-2 rounded py-1 hover:bg-accent-soft">
                {inner}
              </Link>
            ) : (
              <div className="flex min-h-6 items-center gap-2 py-1">{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export const formatValue = fmt
