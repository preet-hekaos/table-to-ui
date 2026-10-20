import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import type { FieldDef, RecordRow, ScreenConfig, TableDef } from '@/api/types'
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

function shownColumns(table: TableDef, config: ScreenConfig): FieldDef[] {
  const usable = table.fields.filter((f) => !f.hidden)
  if (config.columns?.length) return config.columns.map((k) => usable.find((f) => f.key === k)).filter((f): f is FieldDef => !!f)
  return usable.filter((f) => f.type !== 'long_text').slice(0, 6)
}

function filterFields(table: TableDef, config: ScreenConfig): FieldDef[] {
  const usable = table.fields.filter((f) => !f.hidden)
  if (config.filters) return config.filters.map((k) => usable.find((f) => f.key === k)).filter((f): f is FieldDef => !!f)
  return usable.filter((f) => f.filterable && f.type === 'select')
}

function toCsv(fields: FieldDef[], rows: RecordRow[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : Array.isArray(v) ? v.join('; ') : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = fields.map((f) => esc(f.label)).join(',')
  const body = rows.map((r) => fields.map((f) => esc(r.refs?.[f.key]?.label ?? r.data[f.key])).join(','))
  return [head, ...body].join('\n')
}

function columnsFor(table: TableDef, config: ScreenConfig, preview: boolean): ColumnDef<RecordRow, unknown>[] {
  const shown = shownColumns(table, config)
  const cols: ColumnDef<RecordRow, unknown>[] = shown.map((f) => ({
    id: f.key,
    header: f.label,
    cell: ({ row }) => {
      const v = row.original.data[f.key]
      if (f.key === table.title_field && !preview) {
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

interface ListProps {
  tableKey: string
  /** The screen's configuration from the Studio (columns, filters, grouping, actions, empty text). */
  config?: ScreenConfig
  title?: string
  /** Studio preview: the Draft definition of the table, and no navigation away. */
  tableOverride?: TableDef
  preview?: boolean
}

/** Pattern "searchable table": the records list of any table. Sorting and paging happen on the server. */
export function RecordsList({ tableKey, config = {}, title, tableOverride, preview = false }: ListProps) {
  const me = useMe()
  const navigate = useNavigate()
  const [sortState, setSort] = useState<SortState>({ key: 'updated_at', direction: 'desc' })
  const groupBy = config.group_by
  const sort: SortState = groupBy ? { key: groupBy, direction: sortState.key === groupBy ? sortState.direction : 'asc' } : sortState
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<Record<string, string>>({})
  const debouncedQ = useDebounced(q, 250)
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const list = useInfiniteQuery({
    queryKey: ['records', tableKey, sort, debouncedQ, filters],
    queryFn: ({ pageParam }) => {
      // In a Studio preview the Draft may name fields that are not live yet; leave those out.
      const live = new Set(def.data?.table.fields.map((f) => f.key))
      const sent = Object.fromEntries(Object.entries(filters).filter(([k, v]) => v && live.has(k)))
      const sortKey = sort.key === 'updated_at' || live.has(sort.key) ? sort.key : 'updated_at'
      return app.list(tableKey, { sort: sortKey, direction: sort.direction, cursor: pageParam, limit: PAGE, q: debouncedQ, filters: sent })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: def.isSuccess,
    retry: false,
  })
  const table = tableOverride ?? def.data?.table
  const configKey = JSON.stringify(config)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => (table ? columnsFor(table, config, preview) : []), [table, configKey, preview])
  const rows = list.data?.pages.flatMap((p) => p.items) ?? []

  const err = def.error ?? list.error
  if (err instanceof ApiError && err.status === 404) return <NotFound what="app" />
  if (err instanceof ApiError && err.status === 403) return <PermissionDenied />
  if (err) return <ErrorState requestId={(err as ApiError).requestId} onRetry={() => void list.refetch()} />
  if (!table || list.isLoading) return <LoadingState label={`Loading ${tableKey}`} />

  const actions = config.actions ?? ['create']
  const canCreate = actions.includes('create') && can(me.data?.permissions, `record.${tableKey}.create`)
  const add = () => !preview && void navigate({ to: '/records/$table/new', params: { table: tableKey } })
  const exportCsv = () => {
    const blob = new Blob([toCsv(shownColumns(table, config), rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${table.plural_label.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const groupField = groupBy ? table.fields.find((f) => f.key === groupBy) : undefined
  const filters_ = filterFields(table, config)
  const onSort = (key: string) => setSort((s) => ({ key, direction: s.key === key && s.direction === 'asc' ? 'desc' : 'asc' }))
  const sortable = new Set([...table.fields.filter((f) => f.type !== 'long_text').map((f) => f.key), 'updated_at'])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">{title ?? table.plural_label}</h1>
        <span className="ml-auto flex gap-2">
          {actions.includes('export') && rows.length > 0 && (
            <Button variant="secondary" onClick={exportCsv}>
              Export CSV
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" onClick={add}>
              <Plus className="size-4" aria-hidden /> Add {table.label.toLowerCase()}
            </Button>
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label={`Search ${table.plural_label}`}>
        <div className="min-w-48 flex-1">
          <label htmlFor="list-q" className="sr-only">Search {table.plural_label}</label>
          <Input id="list-q" type="search" placeholder={`Search ${table.plural_label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {filters_.map((f) => (
          <div key={f.key}>
            <label htmlFor={`flt-${f.key}`} className="sr-only">Filter by {f.label}</label>
            {f.type === 'select' || f.type === 'boolean' ? (
              <Select id={`flt-${f.key}`} value={filters[f.key] ?? ''} onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}>
                <option value="">All {f.label.toLowerCase()}</option>
                {(f.type === 'boolean' ? ['true', 'false'] : f.options).map((o) => (
                  <option key={o} value={o}>
                    {f.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : o}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id={`flt-${f.key}`}
                className="w-40"
                placeholder={f.label}
                value={filters[f.key] ?? ''}
                onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
      {rows.length === 0 && !q && !Object.values(filters).some(Boolean) ? (
        <EmptyState
          title={`No ${table.plural_label.toLowerCase()} yet`}
          action={
            canCreate && (
              <Button variant="primary" onClick={add}>
                Add {table.label.toLowerCase()}
              </Button>
            )
          }
        >
          {config.empty_text || 'Records you add here appear in this list, newest changes first.'}
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
          groupOf={groupField ? (r) => (groupField.type === 'reference' ? (r.refs?.[groupField.key]?.label ?? '') : String(r.data[groupField.key] ?? '')) || `No ${groupField.label.toLowerCase()}` : undefined}
        />
      )}
    </div>
  )
}
