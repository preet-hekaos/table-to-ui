import { useQuery } from '@tanstack/react-query'
import { app, type ListQuery } from '@/api/endpoints'
import type { TableDef } from '@/api/types'
import { formatField } from '@/patterns/format'

/** How many columns the cards get: one row up to four cards, then two even rows of three. */
export const cardColumns = (n: number) => (n <= 4 ? Math.max(1, n) : 3)

function Card({ label, value, testid }: { label: string; value: React.ReactNode; testid?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5" data-testid={testid}>
      <p className="truncate text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-0.5 truncate leading-tight font-bold text-ink ${typeof value === 'string' && value.length > 12 ? 'text-xl' : 'text-3xl'}`}>{value}</p>
    </div>
  )
}

/** The cards sit on one grid of equal columns, so their size and spacing never depend on how many there are. */
function CardGrid({ count, label, children, note }: { count: number; label: string; children: React.ReactNode; note?: string }) {
  return (
    <div role="group" aria-label={label} data-testid="stats-strip" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]" style={{ '--cols': cardColumns(count) } as React.CSSProperties}>
        {children}
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  )
}

/** Numbers above the table: each card is a name and one number. */
export function StatsStrip({ table, query, whole = false }: { table: TableDef; query: ListQuery; whole?: boolean }) {
  const stats = useQuery({ queryKey: ['stats', table.key, query], queryFn: () => app.stats(table.key, query), placeholderData: (p) => p, retry: false })
  const s = stats.data
  const wholeTable = whole || s?.scope === 'table'
  const by = new Map(table.fields.map((f) => [f.key, f]))
  if (s?.cards) {
    if (s.cards.length === 0) return null
    return (
      <CardGrid
        count={s.cards.length}
        label={wholeTable ? 'Numbers for the whole table' : 'Numbers for the current search'}
        note={wholeTable ? 'Whole table, not narrowed by search or filters.' : undefined}
      >
        {s.cards.map((c, i) => {
          const f = c.field ? by.get(c.field) : undefined
          const shown = c.number === null ? '—' : c.kind === 'number' && f ? formatField(f, c.number) : c.number.toLocaleString('en-IN')
          return <Card key={`${c.label}-${i}`} label={wholeTable && c.label === 'Matching' ? 'Total' : c.label} value={shown} testid="stat-card" />
        })}
      </CardGrid>
    )
  }
  if (!s) return null
  const tiles = s.fields.filter((x) => x.avg !== null || x.sum !== null)
  return (
    <CardGrid count={tiles.length + 1} label={wholeTable ? 'Numbers for the whole table' : 'Numbers for the current search'} note={wholeTable ? 'Whole table, not narrowed by search or filters.' : undefined}>
      <Card label={wholeTable ? 'Total' : 'Matching'} value={s.total.toLocaleString('en-IN')} />
      {tiles.map((x) => {
        const f = by.get(x.key)
        return <Card key={x.key} label={`Average ${x.label}`} value={x.avg === null ? '—' : formatField(f, x.avg)} testid="stat-tile" />
      })}
    </CardGrid>
  )
}
