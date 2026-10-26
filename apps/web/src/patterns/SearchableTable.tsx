import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useState, type ReactNode } from 'react'
import { Button, Table, Td, Th, type SortDirection } from '@/design-system'

export interface SortState {
  key: string
  direction: SortDirection
}

/** Pattern: a table with server-side sorting and cursor paging. The page owns the data; this owns the look and keyboard behaviour. */
export function SearchableTable<T>({
  caption,
  columns,
  rows,
  sort,
  onSort,
  sortableKeys,
  hasMore,
  onLoadMore,
  loadingMore,
  groupOf,
  headerExtra,
  selection,
}: {
  caption: string
  columns: ColumnDef<T, unknown>[]
  rows: T[]
  sort: SortState
  onSort: (key: string) => void
  sortableKeys: Set<string>
  hasMore: boolean
  onLoadMore: () => void
  loadingMore?: boolean
  /** Rows arrive sorted by the grouping field; a heading row starts each group. */
  groupOf?: (row: T) => string
  /** Extra controls on a column heading, such as the filter button. */
  headerExtra?: (columnId: string) => ReactNode
  /** Tick-boxes down the left edge: which rows are picked, and how to pick or clear them. */
  selection?: {
    picked: Set<string>
    rowId: (row: T) => string
    rowLabel: (row: T) => string
    onToggle: (id: string) => void
    onPage: (on: boolean) => void
  }
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const counts = new Map<string, number>()
  if (groupOf) for (const r of rows) counts.set(groupOf(r), (counts.get(groupOf(r)) ?? 0) + 1)
  const flip = (g: string) => setClosed((cur) => { const n = new Set(cur); if (n.has(g)) n.delete(g); else n.add(g); return n })
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), manualSorting: true })
  return (
    <div className="flex flex-col gap-3">
      {groupOf && counts.size > 1 && (
        <div className="flex gap-2 text-xs">
          <Button size="sm" variant="ghost" onClick={() => setClosed(new Set(counts.keys()))}>Collapse all groups</Button>
          <Button size="sm" variant="ghost" onClick={() => setClosed(new Set())}>Expand all groups</Button>
        </div>
      )}
      <Table aria-label={caption}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {selection && (
                <Th className="w-10">
                  <input
                    type="checkbox"
                    className="size-5"
                    aria-label="Select all rows shown"
                    checked={rows.length > 0 && rows.every((r) => selection.picked.has(selection.rowId(r)))}
                    ref={(el) => {
                      if (el) el.indeterminate = rows.some((r) => selection.picked.has(selection.rowId(r))) && !rows.every((r) => selection.picked.has(selection.rowId(r)))
                    }}
                    onChange={(e) => selection.onPage(e.target.checked)}
                  />
                </Th>
              )}
              {hg.headers.map((h) => (
                <Th
                  key={h.id}
                  sortable={sortableKeys.has(h.column.id)}
                  direction={sort.key === h.column.id ? sort.direction : null}
                  onSort={() => onSort(h.column.id)}
                  extra={headerExtra?.(h.column.id)}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </Th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r, i, all) => {
            const g = groupOf?.(r.original)
            const startsGroup = groupOf && (i === 0 || groupOf(all[i - 1]!.original) !== g)
            return (
              <Fragment key={r.id}>
                {startsGroup && (
                  <tr className="bg-soft">
                    <th scope="colgroup" colSpan={columns.length + (selection ? 1 : 0)} className="px-3 py-1.5 text-left text-xs font-bold text-ink">
                      <button type="button" aria-expanded={!closed.has(g!)} onClick={() => flip(g!)} className="inline-flex items-center gap-1.5 hover:text-accent-ink">
                        {closed.has(g!) ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                        {g}
                        <span className="font-normal text-body">({counts.get(g!)}{hasMore ? '+' : ''})</span>
                      </button>
                    </th>
                  </tr>
                )}
                {!(g !== undefined && closed.has(g)) && (
                <tr className={selection?.picked.has(selection.rowId(r.original)) ? 'bg-canvas' : 'hover:bg-canvas'}>
                  {selection && (
                    <Td className="w-10">
                      <input
                        type="checkbox"
                        className="size-5"
                        aria-label={`Select ${selection.rowLabel(r.original)}`}
                        checked={selection.picked.has(selection.rowId(r.original))}
                        onChange={() => selection.onToggle(selection.rowId(r.original))}
                      />
                    </Td>
                  )}
                  {r.getVisibleCells().map((c) => (
                    <Td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</Td>
                  ))}
                </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </Table>
      {hasMore && (
        <div className="flex justify-center">
          <Button onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </div>
  )
}
