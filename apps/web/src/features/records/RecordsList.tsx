import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Bookmark, Plus, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useDebounced } from '@/lib/useDebounced'
import { ApiError } from '@/api/client'
import { app, search, type SavedSearch } from '@/api/endpoints'
import type { FieldDef, RecordRow, ScreenConfig, TableDef } from '@/api/types'
import { Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, Field, Input, LoadingState, NotFound, PermissionDenied, Select, cn, useToast } from '@/design-system'
import { AskInWords } from '@/features/ai/Ai'
import { can, useMe } from '@/features/auth/useMe'
import { SearchableTable, type SortState } from '@/patterns/SearchableTable'
import { formatField } from '@/patterns/format'

const PAGE = 50


function shownColumns(table: TableDef, config: ScreenConfig): FieldDef[] {
  const usable = table.fields.filter((f) => !f.hidden)
  if (config.columns?.length) return config.columns.map((k) => usable.find((f) => f.key === k)).filter((f): f is FieldDef => !!f)
  return usable.filter((f) => f.type !== 'long_text').slice(0, 6)
}

function filterFields(table: TableDef, config: ScreenConfig): FieldDef[] {
  const usable = table.fields.filter((f) => !f.hidden)
  if (config.filters) return config.filters.map((k) => usable.find((f) => f.key === k)).filter((f): f is FieldDef => !!f)
  if (config.facets?.length) return []
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
      if (f.type === 'select' && v) return <Badge tone={v === 'Active' || v === 'Open' ? 'ok' : 'neutral'}>{String(v)}</Badge>
      return formatField(f, v, row.original.refs?.[f.key])
    },
  }))
  for (const c of table.counts ?? []) cols.push({ id: `count.${c.key}`, header: c.label, cell: ({ row }) => row.original.counts?.[c.key] ?? 0 })
  cols.push({ id: 'owner', header: 'Owner', cell: ({ row }) => row.original.owner?.name ?? '—' })
  cols.push({ id: 'updated_at', header: 'Last updated', cell: ({ row }) => new Date(row.original.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) })
  return cols
}

function ReferenceFilter({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const opts = useQuery({ queryKey: ['options', f.ref_table], queryFn: () => app.options(f.ref_table!), staleTime: 30_000 })
  const def = useQuery({ queryKey: ['table', f.ref_table], queryFn: () => app.table(f.ref_table!), staleTime: 60_000 })
  const title = def.data?.table.title_field
  return (
    <Select id={`flt-${f.key}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All {f.label.toLowerCase()}s</option>
      {opts.data?.items.map((r) => <option key={r.id} value={r.id}>{String((title && r.data[title]) ?? r.id)}</option>)}
    </Select>
  )
}

type Criteria = { q: string; filters: Record<string, string>; ranges: Record<string, string> }

/** Facets with counts (S23): pick a value to narrow the list; counts follow the other choices. */
function Facets({ tableKey, fields, criteria, set }: { tableKey: string; fields: string[]; criteria: Criteria; set: (c: Criteria) => void }) {
  const q = useDebounced(criteria.q, 250)
  const facets = useQuery({
    queryKey: ['facets', tableKey, fields, q, criteria.filters, criteria.ranges],
    queryFn: () => app.facets(tableKey, { fields, q, filters: criteria.filters, ranges: criteria.ranges }),
    placeholderData: (prev) => prev,
  })
  if (!facets.data) return <LoadingState label="Counting" />
  return (
    <div className="flex flex-col gap-4" aria-label="Narrow the list" role="group">
      {Object.entries(facets.data.facets).map(([key, f]) => {
        const active = f.kind === 'range' ? criteria.ranges[key] : criteria.filters[key]
        return (
          <fieldset key={key} className="flex flex-col gap-1">
            <legend className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">{f.label}</legend>
            {f.values.length === 0 && <p className="text-xs text-muted">Nothing yet</p>}
            {f.values.map((v) => {
              const on = active === v.value
              return (
                <button
                  key={v.value}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && v.count === 0}
                  onClick={() => {
                    const pick = on ? '' : v.value
                    set(f.kind === 'range' ? { ...criteria, ranges: { ...criteria.ranges, [key]: pick } } : { ...criteria, filters: { ...criteria.filters, [key]: pick } })
                  }}
                  className={cn('flex items-center justify-between rounded-md px-2 py-1 text-left text-sm disabled:opacity-40', on ? 'bg-accent-soft font-semibold text-accent-ink' : 'text-body hover:bg-soft')}
                >
                  <span className="truncate">{v.label}</span>
                  <span className={cn('text-xs', on ? 'text-accent-ink' : 'text-muted')}>{v.count}</span>
                </button>
              )
            })}
          </fieldset>
        )
      })}
    </div>
  )
}

function SaveSearch({ table, screenKey, criteria }: { table: TableDef; screenKey?: string; criteria: Criteria }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const qc = useQueryClient()
  const toast = useToast()
  const save = useMutation({
    mutationFn: () => search.save({ table: table.key, screen: screenKey, name, query: { q: criteria.q, filters: criteria.filters, ranges: criteria.ranges } }),
    onSuccess: async () => {
      toast({ title: `Saved “${name}”`, description: 'Reopen it from the menu.', tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['saved-searches'] })
      setOpen(false)
    },
    onError: (e) => toast({ title: 'Could not save', description: (e as Error).message, tone: 'bad' }),
  })
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Bookmark className="size-4" aria-hidden /> Save search
      </Button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title="Save this search" description="It appears under Saved searches in the menu.">
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
              <Field label="Name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
              </Field>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!name.trim()}>Save</Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

interface ListProps {
  tableKey: string
  /** The screen's configuration from the Studio (columns, filters, facets, grouping, actions, empty text). */
  config?: ScreenConfig
  title?: string
  screenKey?: string
  /** A saved search to open with. */
  initial?: SavedSearch['query']
  /** Studio preview: the Draft definition of the table, and no navigation away. */
  tableOverride?: TableDef
  preview?: boolean
}

/** Pattern "searchable table": the records list of any table. Sorting, paging and counting happen on the server. */
export function RecordsList({ tableKey, config = {}, title, screenKey, initial, tableOverride, preview = false }: ListProps) {
  const me = useMe()
  const navigate = useNavigate()
  const [sortState, setSort] = useState<SortState>({ key: 'updated_at', direction: 'desc' })
  const groupBy = config.group_by
  const sort: SortState = groupBy ? { key: groupBy, direction: sortState.key === groupBy ? sortState.direction : 'asc' } : sortState
  const [criteria, setCriteria] = useState<Criteria>({ q: initial?.q ?? '', filters: initial?.filters ?? {}, ranges: initial?.ranges ?? {} })
  const [showFacets, setShowFacets] = useState(false)
  const { q, filters, ranges } = criteria
  const debouncedQ = useDebounced(q, 250)
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const list = useInfiniteQuery({
    queryKey: ['records', tableKey, sort, debouncedQ, filters, ranges],
    queryFn: ({ pageParam }) => {
      // In a Studio preview the Draft may name fields that are not live yet; leave those out.
      const live = new Set(def.data?.table.fields.map((f) => f.key))
      const keep = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v && live.has(k)))
      const sortKey = sort.key === 'updated_at' || live.has(sort.key) ? sort.key : 'updated_at'
      return app.list(tableKey, { sort: sortKey, direction: sort.direction, cursor: pageParam, limit: PAGE, q: debouncedQ, filters: keep(filters), ranges: keep(ranges) })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: def.isSuccess,
    retry: false,
    placeholderData: (prev) => prev,
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
  if (!table || (list.isLoading && !list.data)) return <LoadingState label={`Loading ${tableKey}`} />

  const actions = config.actions ?? ['create']
  const canCreate = actions.includes('create') && can(me.data?.permissions, `record.${tableKey}.create`)
  const canImport = can(me.data?.permissions, 'import.run')
  const add = () => !preview && void navigate({ to: '/records/$table/new', params: { table: tableKey } })
  const exportCsv = () => {
    const blob = new Blob([toCsv(shownColumns(table, config), rows)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${table.plural_label.toLowerCase().replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }
  const onSort = (key: string) => setSort((s) => ({ key, direction: s.key === key && s.direction === 'asc' ? 'desc' : 'asc' }))
  const sortable = new Set([...table.fields.filter((f) => f.type !== 'long_text').map((f) => f.key), 'updated_at'])
  const groupField = groupBy ? table.fields.find((f) => f.key === groupBy) : undefined
  const filters_ = filterFields(table, config)
  const facetFields = (config.facets ?? []).filter((k) => table.fields.some((f) => f.key === k && !f.hidden))
  const searching = !!q || Object.values(filters).some(Boolean) || Object.values(ranges).some(Boolean)
  const setFilter = (k: string, v: string) => setCriteria({ ...criteria, filters: { ...filters, [k]: v } })
  const chips = [
    ...Object.entries(filters).filter(([, v]) => v).map(([k, v]) => ({ k, kind: 'f' as const, label: `${table.fields.find((f) => f.key === k)?.label}: ${v}` })),
    ...Object.entries(ranges).filter(([, v]) => v).map(([k, v]) => ({ k, kind: 'r' as const, label: `${table.fields.find((f) => f.key === k)?.label}: ${v}` })),
  ]

  const body =
    rows.length === 0 && !searching ? (
      <EmptyState title={`No ${table.plural_label.toLowerCase()} yet`} action={
          (canCreate || (canImport && !preview)) && (
            <span className="flex flex-wrap justify-center gap-2">
              {canCreate && <Button variant="primary" onClick={add}>Add {table.label.toLowerCase()}</Button>}
              {canImport && !preview && <Button variant={canCreate ? 'secondary' : 'primary'} onClick={() => void navigate({ to: '/import', search: {} })}>Import data</Button>}
            </span>
          )
        }>
        {config.empty_text || 'Records you add here appear in this list, newest changes first.'}
      </EmptyState>
    ) : rows.length === 0 ? (
      <EmptyState title="Nothing matches">Try fewer filters or other words.</EmptyState>
    ) : (
      <SearchableTable
        caption={title ?? table.plural_label}
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
    )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink">{title ?? table.plural_label}</h1>
        <span className="ml-auto flex flex-wrap gap-2">
          {searching && !preview && <SaveSearch table={table} screenKey={screenKey} criteria={criteria} />}
          {actions.includes('import') && can(me.data?.permissions, 'import.run') && !preview && (
            <Button variant="secondary" onClick={() => void navigate({ to: '/import', search: {} })}>Import</Button>
          )}
          {actions.includes('export') && rows.length > 0 && <Button variant="secondary" onClick={exportCsv}>Export CSV</Button>}
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
          <Input id="list-q" type="search" placeholder={`Search ${table.plural_label.toLowerCase()}`} value={q} onChange={(e) => setCriteria({ ...criteria, q: e.target.value })} />
        </div>
        {!preview && (
          <AskInWords table={tableKey} onApply={(f, words) => setCriteria({ q: words, filters: f, ranges: {} })} />
        )}
        {filters_.map((f) => (
          <div key={f.key}>
            <label htmlFor={`flt-${f.key}`} className="sr-only">Filter by {f.label}</label>
            {f.type === 'reference' ? (
              <ReferenceFilter f={f} value={filters[f.key] ?? ''} onChange={(v) => setFilter(f.key, v)} />
            ) : f.type === 'select' || f.type === 'boolean' ? (
              <Select id={`flt-${f.key}`} value={filters[f.key] ?? ''} onChange={(e) => setFilter(f.key, e.target.value)}>
                <option value="">All {f.label.toLowerCase()}</option>
                {(f.type === 'boolean' ? ['true', 'false'] : f.options).map((o) => (
                  <option key={o} value={o}>{f.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : o}</option>
                ))}
              </Select>
            ) : (
              <Input id={`flt-${f.key}`} className="w-40" placeholder={f.label} value={filters[f.key] ?? ''} onChange={(e) => setFilter(f.key, e.target.value)} />
            )}
          </div>
        ))}
        {facetFields.length > 0 && (
          <Button variant="secondary" className="lg:hidden" aria-expanded={showFacets} onClick={() => setShowFacets((v) => !v)}>
            <SlidersHorizontal className="size-4" aria-hidden /> Filters
          </Button>
        )}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Active filters">
          {chips.map((c) => (
            <button
              key={c.kind + c.k}
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-ink"
              onClick={() => setCriteria(c.kind === 'f' ? { ...criteria, filters: { ...filters, [c.k]: '' } } : { ...criteria, ranges: { ...ranges, [c.k]: '' } })}
              aria-label={`Remove ${c.label}`}
            >
              {c.label} <X className="size-3" aria-hidden />
            </button>
          ))}
        </div>
      )}
      {facetFields.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[14rem_1fr]">
          <aside className={cn(showFacets ? 'block' : 'hidden', 'lg:block')} data-testid="facets">
            <Facets tableKey={tableKey} fields={facetFields} criteria={criteria} set={setCriteria} />
          </aside>
          <div className="min-w-0">{body}</div>
        </div>
      ) : (
        body
      )}
    </div>
  )
}
