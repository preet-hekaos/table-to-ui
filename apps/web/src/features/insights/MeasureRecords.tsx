import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError } from '@/api/client'
import { app, type RangeQuery } from '@/api/endpoints'
import { Badge, EmptyState, ErrorState, LoadingState, Table, Td, Th } from '@/design-system'
import { RANGES } from './Insights'

/** The records behind one number. The count here always equals the number on the card. */
export function MeasureRecords({ measureKey, range, group, bucket }: { measureKey: string; range: RangeQuery; group?: string; bucket?: string }) {
  const m = useQuery({ queryKey: ['insight', measureKey, range], queryFn: () => app.measure(measureKey, range), retry: false })
  const recs = useQuery({ queryKey: ['insight-records', measureKey, range, group, bucket], queryFn: () => app.measureRecords(measureKey, range, { group, bucket }), retry: false })
  const table = useQuery({ queryKey: ['app-table', recs.data?.table], queryFn: () => app.table(recs.data!.table), enabled: !!recs.data?.table })
  if (recs.isError) {
    const e = recs.error as ApiError
    return e.status === 404 ? <EmptyState title="That measure is not available">It may have been removed, or your role cannot see it.</EmptyState> : <ErrorState requestId={e.requestId} onRetry={() => void recs.refetch()} />
  }
  if (!recs.data || !m.data) return <LoadingState label="Loading records" />
  const t = table.data?.table
  const rangeLabel = m.data.period ? (RANGES.find(([k]) => k === (range.range ?? 'last_30_days'))?.[1] ?? 'Chosen dates') : 'Right now'
  const cols = (t?.fields ?? []).filter((f) => !f.hidden && f.type !== 'long_text' && f.key !== t?.title_field).slice(0, 4)
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link to="/insights" search={range} className="text-sm font-semibold text-accent-ink underline">← Insights</Link>
        <h1 className="mt-1 text-xl font-bold text-ink">{m.data.label}</h1>
        <p className="text-sm text-muted">
          {rangeLabel}
          {group !== undefined && <> · <Badge>{group || '(none)'}</Badge></>}
          {bucket && <> · <Badge>from {bucket}</Badge></>}
        </p>
        <p className="mt-1 text-sm text-ink" data-testid="drill-count">
          {recs.data.total.toLocaleString('en-IN')} {recs.data.total === 1 ? 'record' : 'records'}
          {recs.data.capped && <span className="text-muted"> (showing the first {recs.data.shown})</span>}
        </p>
      </div>
      {recs.data.items.length === 0 ? (
        <EmptyState title="Nothing matches">No records are behind this number.</EmptyState>
      ) : (
        <Table aria-label="Records behind this number">
          <thead>
            <tr>
              <Th>{t?.label ?? 'Record'}</Th>
              {cols.map((f) => (
                <Th key={f.key}>{f.label}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {recs.data.items.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <Td>
                  <Link to="/records/$table/$id" params={{ table: r.table, id: r.id }} className="font-semibold text-accent-ink underline">
                    {String(r.data[t?.title_field ?? ''] ?? r.id.slice(0, 8))}
                  </Link>
                </Td>
                {cols.map((f) => (
                  <Td key={f.key}>{r.data[f.key] === undefined || r.data[f.key] === null ? '' : String(r.data[f.key])}</Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
