import { useQuery } from '@tanstack/react-query'
import { ChartArea, ChartBar, ChartColumn, ChartLine, ChartNoAxesCombined, ChartPie, ChevronDown, ChevronUp, Table2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { app, type ChartMeasureResult, type ChartPoint, type ChartResult } from '@/api/endpoints'
import type { TableDef } from '@/api/types'
import { Button, ErrorState, Table, Td, Th, cn } from '@/design-system'
import { DEFAULT_CHART, type ChartConfig, type ChartType, type TableFeatures } from '@/features/studio/features'
import { formatMoney, formatMonths } from '@/patterns/format'
import { ChartCanvas, SECOND } from './ChartCanvas'
import { NumbersMode, type NumbersState } from '../NumbersMode'

type Criteria = { q: string; filters: Record<string, string>; ranges: Record<string, string>; contains: Record<string, string>; anyof: Record<string, string> }

interface ChartPrefs extends Partial<Omit<ChartConfig, 'measures'>> {
  measures?: ChartConfig['measures']
  /** Series this person has switched off in the legend. */
  off?: string[]
  closed?: boolean
  view?: 'chart' | 'table'
}
const prefsKey = (t: string) => `tableui.chart.${t}`

/** What this person chose for one table's chart; the owner's starting chart applies until they change it. */
function useChartPrefs(table: string) {
  const [prefs, setPrefs] = useState<ChartPrefs>(() => {
    try {
      return JSON.parse(localStorage.getItem(prefsKey(table)) ?? '{}') as ChartPrefs
    } catch {
      return {}
    }
  })
  const update = useCallback(
    (patch: ChartPrefs) =>
      setPrefs((cur) => {
        const next = { ...cur, ...patch }
        try {
          localStorage.setItem(prefsKey(table), JSON.stringify(next))
        } catch {
          /* private mode: lasts for this visit */
        }
        return next
      }),
    [table],
  )
  return [prefs, update] as const
}

const TYPES: { key: ChartType; label: string; Icon: typeof ChartColumn }[] = [
  { key: 'combo', label: 'Bars and line', Icon: ChartNoAxesCombined },
  { key: 'bar', label: 'Bars', Icon: ChartColumn },
  { key: 'hbar', label: 'Horizontal bars', Icon: ChartBar },
  { key: 'line', label: 'Line', Icon: ChartLine },
  { key: 'area', label: 'Area', Icon: ChartArea },
  { key: 'donut', label: 'Share', Icon: ChartPie },
]

const mKey = (m: { agg: string; field?: string | null }) => (m.agg === 'count' ? 'count' : `${m.agg}:${m.field}`)
const parseKey = (k: string): { agg: 'count' | 'sum' | 'avg'; field?: string } => {
  const [agg, field] = k.split(':')
  return agg === 'count' || !field ? { agg: 'count' } : { agg: agg as 'sum' | 'avg', field }
}
const monthShort = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const dayShort = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The last day a group covers, so a click can filter the table to exactly that period. */
function periodEnd(startIso: string, bucket: 'day' | 'week' | 'month') {
  const d = new Date(`${startIso}T00:00:00Z`)
  if (bucket === 'day') return startIso
  if (bucket === 'week') d.setUTCDate(d.getUTCDate() + 6)
  else d.setUTCMonth(d.getUTCMonth() + 1, 0)
  return d.toISOString().slice(0, 10)
}

function Pill({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface pr-2 pl-3 text-sm focus-within:ring-2 focus-within:ring-accent">
      <span className="text-body">{label}</span>
      {children}
    </label>
  )
}
const pillSelect = 'max-w-60 [field-sizing:content] cursor-pointer bg-transparent py-1 font-semibold text-ink outline-none'

/** The chart that stands in for the cards above a table: group by a field, measure one or two things, click to filter. */
export function ChartCard({
  table,
  feat,
  criteria,
  setCriteria,
  numbers,
}: {
  table: TableDef
  feat: TableFeatures
  criteria: Criteria
  setCriteria: (c: Criteria) => void
  numbers: NumbersState
}) {
  const [prefs, setPrefs] = useChartPrefs(table.key)
  const owner = feat.chart ?? DEFAULT_CHART
  const cfg: ChartConfig = {
    type: prefs.type ?? owner.type,
    x: prefs.x ?? owner.x,
    bucket: prefs.bucket ?? owner.bucket,
    measures: prefs.measures ?? owner.measures,
    top: prefs.top ?? owner.top,
  }
  const off = new Set(prefs.off ?? [])
  const measuresParam = cfg.measures.map(mKey).join(',')
  const [lastX, setLastX] = useState<string | null>(null)
  const xKey = cfg.x ?? lastX
  // The chart ignores the filter its own bars make, so the other bars stay in view while one is chosen.
  const without = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== xKey))
  const query = numbers.whole
    ? { q: '', filters: {}, ranges: {}, contains: {}, anyof: {} }
    : { q: criteria.q, filters: without(criteria.filters), ranges: without(criteria.ranges), contains: criteria.contains, anyof: criteria.anyof }
  const chart = useQuery<ChartResult>({
    queryKey: ['chart', table.key, query, cfg.x, cfg.bucket, measuresParam, cfg.top],
    queryFn: async () => {
      const r = await app.chart(table.key, { ...query, x: cfg.x ?? undefined, bucket: cfg.bucket, measures: measuresParam, top: cfg.top })
      setLastX(r.x.key)
      return r
    },
    placeholderData: (p) => p,
    retry: false,
  })
  const data = chart.data
  const isDate = data?.x.type === 'date'
  const bucket = data?.x.bucket ?? cfg.bucket
  const canFilter = !isDate || feat.filterable

  const xLabel = (p: ChartPoint) => {
    if (p.key === '_others') return 'Others'
    if (isDate) return bucket === 'month' ? monthShort.format(new Date(`${p.key}T00:00:00Z`)) : dayShort.format(new Date(`${p.key}T00:00:00Z`))
    if (data?.x.type === 'boolean') return p.label === 'true' ? 'Yes' : p.label === 'false' ? 'No' : p.label
    return p.label
  }
  const fmt = (m: ChartMeasureResult, v: number | null) => {
    if (v === null) return '—'
    if (m.agg !== 'count' && m.type === 'money') return formatMoney(v)
    if (m.agg !== 'count' && m.type === 'months') return formatMonths(v)
    return v.toLocaleString('en-IN')
  }

  // Which group, if any, the table is filtered to right now.
  const selected = (() => {
    if (!data || !xKey) return null
    if (isDate) {
      const r = criteria.ranges[xKey]
      return r ? (data.points.find((p) => `${p.key}..${periodEnd(p.key, bucket)}` === r)?.key ?? null) : null
    }
    const f = criteria.filters[xKey]
    return f ? (data.points.find((p) => p.key.toLowerCase() === f.toLowerCase())?.key ?? null) : null
  })()
  const onPick = !data || !xKey || !canFilter || data.points.length === 0
    ? undefined
    : (p: ChartPoint) => {
        if (p.key === '_others' || p.key === 'Not set') return
        const next: Criteria = { ...criteria, filters: { ...criteria.filters }, ranges: { ...criteria.ranges } }
        if (isDate) next.ranges[xKey] = selected === p.key ? '' : `${p.key}..${periodEnd(p.key, bucket)}`
        else next.filters[xKey] = selected === p.key ? '' : p.key
        setCriteria(next)
      }

  const all = data?.measures ?? []
  const shown = all.filter((m) => !off.has(m.key))
  const groupBy = data?.groupable ?? []
  const numberFields = data?.numbers ?? []
  const options = [
    { key: 'count', label: `Count of ${table.plural_label.toLowerCase()}` },
    ...numberFields.flatMap((n) => [
      { key: `sum:${n.key}`, label: `Total ${n.label.toLowerCase()}` },
      { key: `avg:${n.key}`, label: `Average ${n.label.toLowerCase()}` },
    ]),
  ]
  const setMeasure = (i: number, k: string) => {
    const next = [...cfg.measures]
    if (k === '') next.splice(i, 1)
    else next[i] = parseKey(k)
    setPrefs({ measures: next.slice(0, 2), off: [] })
  }
  const toggle = (k: string) => {
    const now = new Set(off)
    if (now.has(k)) now.delete(k)
    else if (all.length - now.size > 1) now.add(k)
    setPrefs({ off: [...now] })
  }
  const closed = !!prefs.closed
  const view = prefs.view ?? 'chart'
  const title = data ? `${table.plural_label} by ${data.x.label.toLowerCase()}` : `${table.plural_label} chart`
  const summary = data && data.points.length > 0 && shown[0]
    ? `${title}. ${data.points.length} groups. Highest: ${xLabel([...data.points].sort((a, b) => (b.values[shown[0]!.key] ?? 0) - (a.values[shown[0]!.key] ?? 0))[0]!)} with ${fmt(shown[0], [...data.points].sort((a, b) => (b.values[shown[0]!.key] ?? 0) - (a.values[shown[0]!.key] ?? 0))[0]!.values[shown[0]!.key] ?? null)} ${shown[0].label.toLowerCase()}.`
    : title

  return (
    <section aria-label={title} data-testid="chart-card" className="overflow-hidden rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(11_18_32/0.04)]">
      <h2 className="sr-only">{title}</h2>
      {closed && (
        <div className="flex items-center justify-between px-5 py-2">
          <span className="text-sm font-semibold text-body">{title}</span>
          <Button variant="ghost" size="sm" aria-expanded={false} aria-label="Show the chart" onClick={() => setPrefs({ closed: false })}>
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </div>
      )}
      {!closed && (
        <>
          <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3">
            {groupBy.length > 0 && (
              <Pill label="Group by">
                <select aria-label="Group by" className={pillSelect} value={data?.x.key ?? ''} onChange={(e) => setPrefs({ x: e.target.value })}>
                  {groupBy.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                </select>
              </Pill>
            )}
            <Pill label="Measure">
              <select aria-label="Measure" className={pillSelect} value={mKey(cfg.measures[0]!)} onChange={(e) => setMeasure(0, e.target.value)}>
                {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </Pill>
            <Pill label="Line">
              <select aria-label="Second measure" className={pillSelect} value={cfg.measures[1] ? mKey(cfg.measures[1]) : ''} onChange={(e) => setMeasure(1, e.target.value)}>
                <option value="">None</option>
                {options.filter((o) => o.key !== mKey(cfg.measures[0]!)).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </Pill>
            {isDate ? (
              <Pill label="By">
                <select aria-label="Period" className={pillSelect} value={cfg.bucket} onChange={(e) => setPrefs({ bucket: e.target.value as ChartConfig['bucket'] })}>
                  <option value="day">Day</option>
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
              </Pill>
            ) : (
              <Pill label="Top">
                <select aria-label="Groups shown" className={pillSelect} value={cfg.top} onChange={(e) => setPrefs({ top: Number(e.target.value) })}>
                  {[5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </Pill>
            )}
            <ul className="flex gap-2" aria-label="Series">
              {all.map((m, i) => (
                <li key={m.key}>
                  <button type="button" aria-pressed={!off.has(m.key)} onClick={() => toggle(m.key)} className={cn('inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold', off.has(m.key) ? 'text-muted line-through' : 'text-body hover:bg-soft')}>
                    <span className="size-2.5 rounded-sm" style={{ background: off.has(m.key) ? 'var(--color-line)' : i === 0 ? 'var(--color-accent)' : SECOND }} aria-hidden />
                    {m.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                aria-pressed={view === 'table'}
                onClick={() => setPrefs({ view: view === 'table' ? 'chart' : 'table' })}
                className={cn('inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold', view === 'table' ? 'bg-accent-soft text-accent-ink' : 'text-body hover:bg-soft')}
              >
                <Table2 className="size-4" aria-hidden /> Table view
              </button>
              <div role="radiogroup" aria-label="Chart type" className="flex gap-0.5 rounded-xl bg-soft p-[3px]">
                {TYPES.map(({ key, label, Icon }) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={cfg.type === key}
                    aria-label={label}
                    title={label}
                    onClick={() => setPrefs({ type: key })}
                    className={cn('flex h-7 w-8 items-center justify-center rounded-lg', cfg.type === key ? 'bg-surface text-accent-ink shadow-sm' : 'text-body hover:bg-surface')}
                  >
                    <Icon className="size-[18px]" aria-hidden />
                  </button>
                ))}
              </div>
              <NumbersMode n={numbers} />
              <Button variant="ghost" size="sm" aria-expanded aria-label="Hide the chart" onClick={() => setPrefs({ closed: true })}>
                <ChevronUp className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
          <div className="pt-3">
            {chart.isError && !data ? (
              <div className="px-6 pb-5"><ErrorState onRetry={() => void chart.refetch()} /></div>
            ) : !data ? (
              <div className="mx-6 mb-6 h-64 animate-pulse rounded-xl bg-soft" aria-label="Loading the chart" role="status" />
            ) : data.points.length === 0 ? (
              <p className="px-6 pt-6 pb-8 text-center text-sm text-muted">Nothing to chart for this search.</p>
            ) : view === 'table' ? (
              <div className="px-6 pb-5">
                <Table aria-label={title}>
                  <thead>
                    <tr>
                      <Th>{data.x.label}</Th>
                      {data.measures.map((m) => <Th key={m.key} className="text-right">{m.label}</Th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {data.points.map((p) => (
                      <tr key={p.key}>
                        <Td className="font-medium text-ink">{xLabel(p)}</Td>
                        {data.measures.map((m) => <Td key={m.key} className="text-right">{fmt(m, p.values[m.key] ?? null)}</Td>)}
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : (
              <>
                <p className="sr-only">{summary}</p>
                <ChartCanvas type={cfg.type} points={data.points} measures={shown} selected={selected} onPick={onPick} fmt={fmt} xLabel={xLabel} />
              </>
            )}
          </div>
          {selected !== null && data && (
            <p className="flex items-center gap-2 px-6 pb-4 text-sm text-muted" role="status">
              The table below shows only
              <button type="button" onClick={() => onPick?.(data.points.find((p) => p.key === selected)!)} className="rounded-full bg-accent-soft px-2.5 py-0.5 font-semibold text-accent-ink hover:underline">
                {data.x.label} = {xLabel(data.points.find((p) => p.key === selected)!)} ✕
              </button>
            </p>
          )}
          {selected === null && onPick && data && data.points.length > 0 && view === 'chart' && <p className="px-6 pb-4 text-right text-xs text-muted">Click a group to filter the table.</p>}
        </>
      )}
    </section>
  )
}
