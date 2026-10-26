import { useQuery } from '@tanstack/react-query'
import { app, type ListQuery } from '@/api/endpoints'
import type { TableDef } from '@/api/types'
import { formatField } from '@/patterns/format'

/** Totals and averages of number fields over everything the current search matches. */
export function StatsStrip({ table, query }: { table: TableDef; query: ListQuery }) {
  const stats = useQuery({ queryKey: ['stats', table.key, query], queryFn: () => app.stats(table.key, query), placeholderData: (p) => p, retry: false })
  const s = stats.data
  if (!s || s.fields.length === 0) return null
  const by = new Map(table.fields.map((f) => [f.key, f]))
  return (
    <div role="group" aria-label="Numbers for the current search" className="flex flex-wrap gap-2" data-testid="stats-strip">
      <div className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-body">
        <p className="font-semibold text-ink">Matching</p>
        <p>{s.total.toLocaleString('en-IN')}</p>
      </div>
      {s.fields.map((x) => {
        const f = by.get(x.key)
        const show = (v: number | null) => (v === null ? '—' : formatField(f, v))
        return (
          <div key={x.key} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-body">
            <p className="font-semibold text-ink">{x.label}</p>
            <p>
              Average {show(x.avg)}
              {x.type !== 'months' && <> · Total {show(x.sum)}</>}
            </p>
            <p>
              Lowest {show(x.min)} · Highest {show(x.max)}
            </p>
          </div>
        )
      })}
    </div>
  )
}
