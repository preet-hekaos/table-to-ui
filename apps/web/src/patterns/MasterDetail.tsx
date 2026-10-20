import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import type { RecordRow, ScreenConfig, TableDef } from '@/api/types'
import { Button, EmptyState, ErrorState, Input, LoadingState, Select, cn } from '@/design-system'
import { useDebounced } from '@/lib/useDebounced'
import { can, useMe } from '@/features/auth/useMe'
import { RecordDetail } from '@/features/records/RecordDetail'
import { formatField } from './format'

/** Pattern "master-detail": a list on the left, the chosen record (with its related tabs) on the right. */
export function MasterDetail({
  tableKey,
  title,
  config = {},
  tableOverride,
  preview = false,
}: {
  tableKey: string
  title?: string
  config?: ScreenConfig
  tableOverride?: TableDef
  preview?: boolean
}) {
  const me = useMe()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [mine, setMine] = useState(false)
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [has, setHas] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string | null>(null)
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const dq = useDebounced(q, 250)
  const list = useQuery({
    queryKey: ['records', tableKey, 'md', dq, mine, filters, has],
    queryFn: () => app.list(tableKey, { limit: 100, q: dq, owner: mine ? 'me' : undefined, filters, has }),
    retry: false,
    enabled: def.isSuccess,
    placeholderData: (p) => p,
  })
  const table = tableOverride ?? def.data?.table
  const err = def.error ?? list.error
  if (err) return <ErrorState requestId={(err as ApiError).requestId} onRetry={() => void list.refetch()} />
  if (!table || list.isLoading) return <LoadingState label={`Loading ${tableKey}`} />
  const rows: RecordRow[] = list.data?.items ?? []
  const sub = table.fields.find((f) => f.key === (config.columns?.find((c) => c !== table.title_field) ?? '')) ?? table.fields.find((f) => f.key !== table.title_field && !f.hidden && f.type !== 'long_text')
  const current = picked ?? rows[0]?.id ?? null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">{title ?? table.plural_label}</h1>
        {(config.actions ?? ['create']).includes('create') && can(me.data?.permissions, `record.${tableKey}.create`) && (
          <Button variant="primary" className="ml-auto" onClick={() => !preview && void navigate({ to: '/records/$table/new', params: { table: tableKey } })}>
            <Plus className="size-4" aria-hidden /> Add {table.label.toLowerCase()}
          </Button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <div className="flex flex-col gap-2">
          <label htmlFor={`md-q-${tableKey}`} className="sr-only">
            Search {table.plural_label}
          </label>
          <Input id={`md-q-${tableKey}`} type="search" placeholder={`Search ${table.plural_label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex flex-wrap gap-2 text-sm" role="group" aria-label={`Filter ${table.plural_label}`}>
            {(config.filters ?? []).map((k) => table.fields.find((f) => f.key === k)).filter((f) => f?.type === 'select').map((f) => (
              <Select key={f!.key} aria-label={`Filter by ${f!.label}`} className="h-8 w-auto text-xs" value={filters[f!.key] ?? ''} onChange={(e) => setFilters({ ...filters, [f!.key]: e.target.value })}>
                <option value="">All {f!.label.toLowerCase()}</option>
                {f!.options.map((o) => <option key={o}>{o}</option>)}
              </Select>
            ))}
            <label className="flex items-center gap-1 text-xs text-body"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Mine</label>
            {(table.counts ?? []).map((c) => (
              <label key={c.key} className="flex items-center gap-1 text-xs text-body">
                <input type="checkbox" checked={has[c.key] === 'yes'} onChange={(e) => setHas({ ...has, [c.key]: e.target.checked ? 'yes' : '' })} /> With {c.label.toLowerCase()}
              </label>
            ))}
          </div>
          {rows.length === 0 ? (
            <EmptyState title={`No ${table.plural_label.toLowerCase()} yet`}>{config.empty_text || 'Add one to see it here.'}</EmptyState>
          ) : (
            <ul className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto" aria-label={table.plural_label}>
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    aria-current={r.id === current ? 'true' : undefined}
                    onClick={() => setPicked(r.id)}
                    className={cn('flex w-full flex-col rounded-md px-3 py-2 text-left', r.id === current ? 'bg-accent-soft' : 'hover:bg-soft')}
                  >
                    <span className="text-sm font-semibold text-ink">{String(r.data[table.title_field] ?? '')}</span>
                    <span className={cn('text-xs', r.id === current ? 'text-accent-ink' : 'text-muted')}>
                      {[sub ? formatField(sub, r.data[sub.key], r.refs?.[sub.key]) : null, r.owner?.name, ...(table.counts ?? []).map((c) => `${r.counts?.[c.key] ?? 0} ${c.label.toLowerCase()}`)]
                        .filter(Boolean)
                        .map((x, i) => (
                          <span key={i}>
                            {i > 0 && ' · '}
                            {x}
                          </span>
                        ))}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>{current && !preview ? <RecordDetail key={current} tableKey={tableKey} id={current} embedded /> : current ? <p className="text-sm text-muted">The chosen record opens here.</p> : null}</div>
      </div>
    </div>
  )
}
