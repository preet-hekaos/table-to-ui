import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import type { RecordRow, TableDef } from '@/api/types'
import { Badge, Button, EmptyState, Input, Select, ErrorState, LoadingState, NotFound, PermissionDenied } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'
import { SearchableTable, type SortState } from '@/patterns/SearchableTable'
import { formatField } from '@/patterns/format'

const PAGE = 50

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function columnsFor(table: TableDef): ColumnDef<RecordRow, unknown>[] {
  const shown = table.fields.filter((f) => f.type !== 'long_text' && !f.hidden).slice(0, 6)
  const cols: ColumnDef<RecordRow, unknown>[] = shown.map((f) => ({
    id: f.key,
    header: f.label,
    cell: ({ row }) => {
      const v = row.original.data[f.key]
      if (f.key === table.title_field) {
        return (
          <Link to="/records/$table/$id" params={{ table: table.key, id: row.original.id }} className="font-semibold text-accent-ink hover:underline">
            {String(v ?? '')}
          </Link>
        )
      }
      if (f.type === 'select' && v) return <Badge tone={v === 'Active' ? 'ok' : 'neutral'}>{String(v)}</Badge>
      return formatField(f, v, row.original.refs?.[f.key])
    },
  }))
  cols.push({ id: 'updated_at', header: 'Last updated', cell: ({ row }) => new Date(row.original.updated_at).toLocaleString() })
  return cols
}

/** Thin 3.4: the records list of any live table. Sorting and paging happen on the server. */
export function RecordsList({ tableKey }: { tableKey: string }) {
  const me = useMe()
  const navigate = useNavigate()
  const [sort, setSort] = useState<SortState>({ key: 'updated_at', direction: 'desc' })
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedQ = useDebounced(q, 250)
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const list = useInfiniteQuery({
    queryKey: ['records', tableKey, sort, debouncedQ, filters],
    queryFn: ({ pageParam }) => app.list(tableKey, { sort: sort.key, direction: sort.direction, cursor: pageParam, limit: PAGE, q: debouncedQ, filters }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: def.isSuccess,
    retry: false,
  })
  const table = def.data?.table
  const columns = useMemo(() => (table ? columnsFor(table) : []), [table])
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []

  const err = def.error ?? list.error
  if (err instanceof ApiError && err.status === 404) return <NotFound what="app" />
  if (err instanceof ApiError && err.status === 403) return <PermissionDenied />
  if (err) return <ErrorState requestId={(err as ApiError).requestId} onRetry={() => void list.refetch()} />
  if (!table || list.isLoading) return <LoadingState label={`Loading ${tableKey}`} />

  const canCreate = can(me.data?.permissions, `record.${tableKey}.create`)
  const onSort = (key: string) => setSort((s) => ({ key, direction: s.key === key && s.direction === 'asc' ? 'desc' : 'asc' }))
  const sortable = new Set([...table.fields.filter((f) => f.type !== 'long_text').map((f) => f.key), 'updated_at'])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">{table.plural_label}</h1>
        {canCreate && (
          <Button variant="primary" className="ml-auto" onClick={() => void navigate({ to: '/records/$table/new', params: { table: tableKey } })}>
            <Plus className="size-4" aria-hidden /> Add {table.label.toLowerCase()}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label={`Search ${table.plural_label}`}>
        <div className="min-w-48 flex-1">
          <label htmlFor="list-q" className="sr-only">Search {table.plural_label}</label>
          <Input id="list-q" type="search" placeholder={`Search ${table.plural_label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {table.fields.filter((f) => f.filterable && f.type === 'select').map((f) => (
          <div key={f.key}>
            <label htmlFor={`flt-${f.key}`} className="sr-only">Filter by {f.label}</label>
            <Select id={`flt-${f.key}`} value={filters[f.key] ?? ''} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}>
              <option value="">All {f.label.toLowerCase()}</option>
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          </div>
        ))}
      </div>
      {rows.length === 0 && !q && !Object.values(filters).some(Boolean) ? (
        <EmptyState
          title={`No ${table.plural_label.toLowerCase()} yet`}
          action={
            canCreate && (
              <Button variant="primary" onClick={() => void navigate({ to: '/records/$table/new', params: { table: tableKey } })}>
                Add {table.label.toLowerCase()}
              </Button>
            )
          }
        >
          Records you add here appear in this list, newest changes first.
        </EmptyState>
      ) : (
        <SearchableTable
          caption={table.plural_label}
          columns={columns}
          rows={rows}
          sort={sort}
          onSort={onSort}
          sortableKeys={sortable}
          hasMore={!!list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          loadingMore={list.isFetchingNextPage}
        />
      )}
    </div>
  )
}
