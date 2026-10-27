import { useQuery } from '@tanstack/react-query'
import { app, type ListQuery } from '@/api/endpoints'
import type { TableDef } from '@/api/types'
import { formatField } from '@/patterns/format'

/** Totals and averages of number fields over everything the current search matches. */
export function StatsStrip({ table, query }: { table: TableDef; query: ListQuery }) {
  const stats = useQuery({ queryKey: ['stats', table.key, query], queryFn: () => app.stats(table.key, query), placeholderData: (p) => p, retry: false })
  const s = stats.data
  const by = new Map(table.fields.map((f) => [f.key, f]))
  if (s?.cards) {
    // Cards the owner chose in Studio: one number each, large, with its name above.
    if (s.cards.length === 0) return null
    return (
      <div role="group" aria-label={s.scope === 'table' ? 'Numbers for the whole table' : 'Numbers for the current search'} className="flex flex-wrap gap-3" data-testid="stats-strip">
        {s.cards.map((c, i) => {
          const f = c.field ? by.get(c.field) : undefined
          const shown = c.number === null ? '—' : c.kind === 'number' && f ? formatField(f, c.number) : c.number.toLocaleString('en-IN')
          return (
            <div key={`${c.label}-${i}`} className="min-w-36 rounded-lg border border-line bg-surface px-4 py-2.5" data-testid="stat-card">
              <p className="text-xs font-semibold text-muted">{c.label}</p>
              <p className="text-2xl leading-tight font-bold text-ink">{shown}</p>
            </div>
          )
        })}
        {s.scope === 'table' && <p className="self-end pb-1 text-xs text-muted">Whole table, not narrowed by search or filters.</p>}
      </div>
    )
  }
  if (!s || s.fields.length === 0) return null
  return (
    <div role="group" aria-label="Numbers for the current search" className="flex flex-wrap gap-3" data-testid="stats-strip">
      <div className="min-w-36 rounded-lg border border-line bg-surface px-4 py-2.5">
        <p className="text-xs font-semibold text-muted">Matching</p>
        <p className="text-2xl leading-tight font-bold text-ink">{s.total.toLocaleString('en-IN')}</p>
      </div>
      {s.fields.filter((x) => x.avg !== null || x.sum !== null).map((x) => {
        const f = by.get(x.key)
        const show = (v: number | null) => (v === null ? '—' : formatField(f, v))
        return (
          <div key={x.key} className="min-w-44 rounded-lg border border-line bg-surface px-4 py-2.5" data-testid="stat-tile">
            <p className="text-xs font-semibold text-muted">{x.label}</p>
            <p className="text-2xl leading-tight font-bold text-ink">{show(x.avg)}</p>
            <p className="text-xs text-muted">
              Average
              {x.type !== 'months' && <> · Total {show(x.sum)}</>}
            </p>
            <p className="text-xs text-muted">
              Range {show(x.min)} to {show(x.max)}
            </p>
          </div>
        )
      })}
    </div>
  )
}
