import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ApiError } from '@/api/client'
import { app, type RangeQuery } from '@/api/endpoints'
import type { Measure } from '@/api/types'
import { Card, CardTitle, EmptyState, ErrorState, Field, Input, LoadingState, Select } from '@/design-system'
import { useNavigate } from '@tanstack/react-router'
import { ExplainNumber } from '@/features/ai/Ai'
import { BarsChart, TrendChart, formatValue, type DrillLink } from './charts'

export const RANGES: [string, string][] = [
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['last_30_days', 'Last 30 days'],
  ['last_90_days', 'Last 90 days'],
  ['this_year', 'This year'],
  ['custom', 'Pick dates'],
]


export function drillFor(key: string, range: RangeQuery, extra: { group?: string; bucket?: string } = {}): DrillLink {
  return { to: '/insights/$key', params: { key }, search: { ...range, ...extra } }
}

function RangeBar({ value, onChange }: { value: RangeQuery; onChange: (r: RangeQuery) => void }) {
  const preset = value.range ?? 'last_30_days'
  const [start, setStart] = useState(value.start ?? '')
  const [end, setEnd] = useState(value.end ?? '')
  const bad = preset === 'custom' && !!start && !!end && start > end
  const pick = (s: string, e: string) => {
    if (s && e && s <= e) onChange({ range: 'custom', start: s, end: e })
  }
  return (
    <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Date range">
      <Field label="Dates">
        <Select value={preset} onChange={(e) => (e.target.value === 'custom' ? onChange({ range: 'custom', start: value.start, end: value.end }) : onChange({ range: e.target.value }))}>
          {RANGES.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </Select>
      </Field>
      {preset === 'custom' && (
        <>
          <Field label="From">
            <Input type="date" value={start} onChange={(e) => { setStart(e.target.value); pick(e.target.value, end) }} />
          </Field>
          <Field label="To" error={bad ? 'The end date is before the start date.' : undefined}>
            <Input type="date" value={end} onChange={(e) => { setEnd(e.target.value); pick(start, e.target.value) }} />
          </Field>
        </>
      )}
    </div>
  )
}

function asOf(m: Measure) {
  return m.as_of ? `As of ${new Date(m.as_of).toLocaleTimeString()}` : 'No data yet'
}

function MeasureCard({ m, range }: { m: Measure; range: RangeQuery }) {
  const unit = m.series && m.display === 'trend' ? (m.series.length > 1 ? guessUnit(m.series[0]!.label, m.series[1]!.label) : 'week') : undefined
  return (
    <Card data-testid={`insight-${m.key}`} className="flex flex-col gap-2">
      <div>
        <CardTitle className="text-sm">{m.label}</CardTitle>
        {m.help && <p className="text-xs text-muted">{m.help}</p>}
      </div>
      <Link {...drillFor(m.key, range)} className="w-fit rounded text-3xl font-bold text-ink hover:underline" aria-label={`${m.label}: ${formatValue(m.value)}. Show records`}>
        {formatValue(m.value)}
      </Link>
      {m.display === 'trend' && m.series && <TrendChart label={m.label} series={m.series} unit={unit} drill={(b) => drillFor(m.key, range, { bucket: b })} />}
      {m.display === 'bars' && m.series && <BarsChart label={m.label} series={m.series} drill={(g) => drillFor(m.key, range, { group: g })} />}
      {range.range !== 'custom' && <ExplainNumber measure={m.key} table={m.table} range={range.range ?? 'last_30_days'} />}
      <p className="mt-auto text-xs text-muted">
        {m.period ? '' : 'Right now · '}
        {asOf(m)}
      </p>
    </Card>
  )
}

function guessUnit(a: string, b: string): 'day' | 'week' | 'month' {
  const days = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
  return days <= 1 ? 'day' : days <= 8 ? 'week' : 'month'
}

/** Every governed number in one place. Numbers come from the analytics store; each links to its records. */
export function Insights({ range }: { range: RangeQuery }) {
  const navigate = useNavigate()
  const q = useQuery({ queryKey: ['insights', range], queryFn: () => app.measures(range), retry: false, refetchInterval: 30_000, enabled: range.range !== 'custom' || (!!range.start && !!range.end) })
  const notLive = q.error instanceof ApiError && q.error.status === 404
  const setRange = (r: RangeQuery) => void navigate({ to: '/insights', search: r })
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Insights</h1>
          <p className="text-sm text-muted">Numbers update within seconds of a change. Click any number to see the records behind it.</p>
        </div>
        <RangeBar value={range} onChange={setRange} />
      </div>
      {range.range === 'custom' && !(range.start && range.end) ? (
        <EmptyState title="Pick both dates">Choose a start and an end date to see the numbers.</EmptyState>
      ) : q.isLoading ? (
        <LoadingState label="Loading insights" />
      ) : notLive ? (
        <EmptyState title="Your app is not live yet">Publish it from the Studio to see numbers here.</EmptyState>
      ) : q.error ? (
        <ErrorState requestId={(q.error as ApiError).requestId} onRetry={() => void q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState title="No measures to show">Ask a workspace admin to add measures in the Studio.</EmptyState>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((m) => (
            <MeasureCard key={m.key} m={m} range={range} />
          ))}
        </div>
      )}
    </div>
  )
}
