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
import { TableToolbar } from '@/patterns/TableToolbar'
import { featuresOf } from '@/features/studio/features'
import { BulkBar } from './BulkBar'
import { ExportDialog } from './ExportDialog'
import { InlineCell, InlineEditContext, inlineEditable } from './InlineCell'
import { HeaderFilter, describe, filterKind } from './HeaderFilter'
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
      if (f.type === 'select' && v) {
        const badge = <Badge tone={v === 'Active' || v === 'Open' ? 'ok' : 'neutral'}>{String(v)}</Badge>
        return inlineEditable(table, f) ? <InlineCell row={row.original} f={f}>{badge}</InlineCell> : badge
      }
      const shown = formatField(f, v, row.original.refs?.[f.key])
      return inlineEditable(table, f) ? <InlineCell row={row.original} f={f}>{shown}</InlineCell> : shown
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

type Criteria = { q: string; filters: Record<string, string>; ranges: Record<string, string>; contains: Record<string, string>; anyof: Record<string, string> }

/** Facets with counts (S23): pick a value to narrow the list; counts follow the other choices. */
function Facets({ tableKey, fields, criteria, set }: { tableKey: string; fields: string[]; criteria: Criteria; set: (c: Criteria) => void }) {
  const q = useDebounced(criteria.q, 250)
  const facets = useQuery({
    queryKey: ['facets', tableKey, fields, q, criteria.filters, criteria.ranges, criteria.contains, criteria.anyof],
    queryFn: () => app.facets(tableKey, { fields, q, filters: criteria.filters, ranges: criteria.ranges, contains: criteria.contains, anyof: criteria.anyof }),
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
    mutationFn: () => search.save({ table: table.key, screen: screenKey, name, query: { q: criteria.q, filters: criteria.filters, ranges: criteria.ranges, contains: criteria.contains, anyof: criteria.anyof } }),
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
  const [sortChoice, setSort] = useState<SortState | null>(null)
  const [criteria, setCriteriaRaw] = useState<Criteria>({ q: initial?.q ?? '', filters: initial?.filters ?? {}, ranges: initial?.ranges ?? {}, contains: initial?.contains ?? {}, anyof: initial?.anyof ?? {} })
  const [showFacets, setShowFacets] = useState(false)
  const [groupChoice, setGroupChoice] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState<{ ids: string[] | null } | null>(null)
  // A different search is a different set of rows, so what was ticked no longer applies.
  const setCriteria = (c: Criteria) => {
    setCriteriaRaw(c)
    setPicked(new Set())
  }
  const { q, filters, ranges, contains, anyof } = criteria
  const debouncedQ = useDebounced(q, 250)
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const table = tableOverride ?? def.data?.table
  const feat = featuresOf(table)
  // The screen can start the list grouped; the person can change or clear it while it is open.
  const groupBy = feat.grouping ? (groupChoice ?? config.group_by) || undefined : undefined
  const sortState: SortState = sortChoice ?? (feat.sort_filter && feat.default_sort ? { key: feat.default_sort.field, direction: feat.default_sort.direction } : { key: 'updated_at', direction: 'desc' })
  const sort: SortState = groupBy ? { key: groupBy, direction: sortState.key === groupBy ? sortState.direction : 'asc' } : sortState
  const list = useInfiniteQuery({
    queryKey: ['records', tableKey, sort, debouncedQ, filters, ranges, contains, anyof],
    queryFn: ({ pageParam }) => {
      // In a Studio preview the Draft may name fields that are not live yet; leave those out.
      const live = new Set(def.data?.table.fields.map((f) => f.key))
      const keep = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v && live.has(k)))
      const sortKey = sort.key === 'updated_at' || live.has(sort.key) ? sort.key : 'updated_at'
      return app.list(tableKey, { sort: sortKey, direction: sort.direction, cursor: pageParam, limit: PAGE, q: debouncedQ, filters: keep(filters), ranges: keep(ranges), contains: keep(contains), anyof: keep(anyof) })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next_cursor,
    enabled: def.isSuccess,
    retry: false,
    placeholderData: (prev) => prev,
  })
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
  const keepSet = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v))
  const selectable = feat.select_bulk && !preview && feat.bulk_actions.length > 0
  const onSort = (key: string) => setSort({ key, direction: sortState.key === key && sortState.direction === 'asc' ? 'desc' : 'asc' })
  const sortable = new Set(
    feat.sort_filter
      ? [...table.fields.filter((f) => f.type !== 'long_text' && !feat.unsortable.includes(f.key)).map((f) => f.key), ...(feat.unsortable.includes('updated_at') ? [] : ['updated_at'])]
      : [],
  )
  const filterable = new Map<string, FieldDef>(
    feat.sort_filter ? table.fields.filter((f) => !f.hidden && !feat.unfilterable.includes(f.key) && filterKind(f)).map((f) => [f.key, f] as [string, FieldDef]) : [],
  )
  const groupable = table.fields.filter((f) => !f.hidden && ['select', 'boolean', 'reference', 'text'].includes(f.type))
  const groupField = groupBy ? table.fields.find((f) => f.key === groupBy) : undefined
  const filters_ = filterFields(table, config)
  const facetFields = (config.facets ?? []).filter((k) => table.fields.some((f) => f.key === k && !f.hidden))
  const searching = !!q || [filters, ranges, contains, anyof].some((m) => Object.values(m).some(Boolean))
  const setFilter = (k: string, v: string) => setCriteria({ ...criteria, filters: { ...filters, [k]: v } })
  type Slot = 'filters' | 'ranges' | 'contains' | 'anyof'
  const chipFor = (slot: Slot, k: string, v: string) => {
    const f = table.fields.find((x) => x.key === k)
    return { k, slot, label: (f && describe(f, criteria)) || `${f?.label ?? k}: ${v}` }
  }
  const chips = (['filters', 'ranges', 'contains', 'anyof'] as Slot[]).flatMap((slot) =>
    Object.entries(criteria[slot]).filter(([, v]) => v).map(([k, v]) => chipFor(slot, k, v)),
  )

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
      <>
      <TableToolbar summary={`${rows.length.toLocaleString('en-IN')}${list.hasNextPage ? '+' : ''} ${(rows.length === 1 && !list.hasNextPage ? table.label : table.plural_label).toLowerCase()} shown`} >
        {feat.grouping && !preview && groupable.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-body">
            Group by
            <Select aria-label="Group by" className="h-8 w-44" value={groupBy ?? ''} onChange={(e) => setGroupChoice(e.target.value)}>
              <option value="">No grouping</option>
              {groupable.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
          </label>
        )}
      </TableToolbar>
      {selectable && (
        <BulkBar
          key={JSON.stringify(criteria)}
          table={table}
          feat={feat}
          picked={picked}
          query={{ q: debouncedQ, filters: keepSet(filters), ranges: keepSet(ranges), contains: keepSet(contains), anyof: keepSet(anyof) }}
          allShown={rows.length > 0 && rows.every((r) => picked.has(r.id))}
          canUpdate={can(me.data?.permissions, `record.${tableKey}.update`)}
          canDelete={can(me.data?.permissions, `record.${tableKey}.delete`)}
          onClear={() => setPicked(new Set())}
          onExport={(ids) => setExporting({ ids: ids ? [...ids] : null })}
        />
      )}
      {exporting && (
        <ExportDialog
          open
          onOpenChange={(o) => !o && setExporting(null)}
          table={table}
          feat={feat}
          shown={shownColumns(table, config)}
          count={exporting.ids ? `${exporting.ids.length.toLocaleString('en-IN')} selected` : searching ? 'Everything in the current search' : `All ${table.plural_label.toLowerCase()}`}
          request={
            exporting.ids
              ? { ids: exporting.ids, sort: sort.key, direction: sort.direction }
              : { q: debouncedQ || undefined, filters: keepSet(filters), ranges: keepSet(ranges), contains: keepSet(contains), anyof: keepSet(anyof), sort: sort.key, direction: sort.direction }
          }
        />
      )}
      <SearchableTable
        caption={title ?? table.plural_label}
        columns={columns}
        rows={rows}
        sort={sort}
        onSort={onSort}
        sortableKeys={sortable}
        selection={
          selectable
            ? {
                picked,
                rowId: (r) => r.id,
                rowLabel: (r) => String(r.data[table.title_field] ?? 'row'),
                onToggle: (id) => setPicked((cur) => { const n = new Set(cur); if (n.has(id)) n.delete(id); else n.add(id); return n }),
                onPage: (on) => setPicked(on ? new Set(rows.map((r) => r.id)) : new Set()),
              }
            : undefined
        }
        headerExtra={(id) => {
          const f = filterable.get(id)
          return f && !preview ? <HeaderFilter f={f} tableKey={tableKey} criteria={criteria} onApply={(n) => setCriteria({ ...criteria, ...n })} /> : null
        }}
        hasMore={!!list.hasNextPage}
        onLoadMore={() => void list.fetchNextPage()}
        loadingMore={list.isFetchingNextPage}
        groupOf={groupField ? (r) => (groupField.type === 'reference' ? (r.refs?.[groupField.key]?.label ?? '') : String(r.data[groupField.key] ?? '')) || `No ${groupField.label.toLowerCase()}` : undefined}
      />
      </>
    )

  return (
    <InlineEditContext.Provider value={feat.inline_edit && !preview && can(me.data?.permissions, `record.${tableKey}.update`) ? { table } : null}>
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink">{title ?? table.plural_label}</h1>
        <span className="ml-auto flex flex-wrap gap-2">
          {searching && !preview && <SaveSearch table={table} screenKey={screenKey} criteria={criteria} />}
          {feat.import_data && canImport && !preview && (rows.length > 0 || searching) && (
            <Button variant="secondary" onClick={() => void navigate({ to: '/import', search: { table: tableKey } })}>Import data</Button>
          )}
          {feat.export_data && rows.length > 0 && !preview && (
            <Button variant="secondary" onClick={() => setExporting({ ids: null })}>Export</Button>
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
          <Input id="list-q" type="search" placeholder={`Search ${table.plural_label.toLowerCase()}`} value={q} onChange={(e) => setCriteria({ ...criteria, q: e.target.value })} />
        </div>
        {!preview && (
          <AskInWords table={tableKey} onApply={(f, words) => setCriteria({ q: words, filters: f, ranges: {}, contains: {}, anyof: {} })} />
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
              key={c.slot + c.k}
              type="button"
              className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-ink"
              onClick={() => setCriteria({ ...criteria, [c.slot]: { ...criteria[c.slot], [c.k]: '' } })}
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
    </InlineEditContext.Provider>
  )
}
