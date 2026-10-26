import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
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
  reorder,
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
  /** Drag handles down the left edge: drop a row on another, or move it with the arrow keys. */
  reorder?: {
    rowId: (row: T) => string
    rowLabel: (row: T) => string
    /** Put the row just before another, or last when null. */
    onMove: (id: string, before: string | null) => void
    /** Another page of rows is still to come, so "last" is not known yet. */
    hasMore: boolean
  }
  /** Tick-boxes down the left edge: which rows are picked, and how to pick or clear them. */
  selection?: {
    picked: Set<string>
    rowId: (row: T) => string
    rowLabel: (row: T) => string
    onToggle: (id: string) => void
    onPage: (on: boolean) => void
  }
}) {
  const dragged = useRef<string | null>(null)
  const refocus = useRef<string | null>(null)
  const [said, setSaid] = useState('')
  const order = rows.map((r) => reorder?.rowId(r) ?? '').join(',')
  useEffect(() => {
    if (!refocus.current) return
    document.querySelector<HTMLElement>(`[data-handle="${refocus.current}"]`)?.focus()
    refocus.current = null
  }, [order])
  const moveTo = (from: number, to: number) => {
    if (!reorder || from === to) return
    const id = reorder.rowId(rows[from]!)
    // Dropping lower down means "before the row after the target".
    const beforeIndex = to > from ? to + 1 : to
    const before = rows[beforeIndex]
    if (!before && reorder.hasMore) return // the end of the list is not loaded yet
    reorder.onMove(id, before ? reorder.rowId(before) : null)
    setSaid(`Moved ${reorder.rowLabel(rows[from]!)} to position ${to + 1}`)
  }
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
      {reorder && <p role="status" aria-live="polite" className="sr-only">{said}</p>}
      <Table aria-label={caption}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {reorder && (
                <Th className="w-8">
                  <span className="sr-only">Move</span>
                </Th>
              )}
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
                    <th scope="colgroup" colSpan={columns.length + (selection ? 1 : 0) + (reorder ? 1 : 0)} className="px-3 py-1.5 text-left text-xs font-bold text-ink">
                      <button type="button" aria-expanded={!closed.has(g!)} onClick={() => flip(g!)} className="inline-flex items-center gap-1.5 hover:text-accent-ink">
                        {closed.has(g!) ? <ChevronRight className="size-4" aria-hidden /> : <ChevronDown className="size-4" aria-hidden />}
                        {g}
                        <span className="font-normal text-body">({counts.get(g!)}{hasMore ? '+' : ''})</span>
                      </button>
                    </th>
                  </tr>
                )}
                {!(g !== undefined && closed.has(g)) && (
                <tr
                  className={selection?.picked.has(selection.rowId(r.original)) ? 'bg-canvas' : 'hover:bg-canvas'}
                  onDragOver={reorder ? (e) => e.preventDefault() : undefined}
                  onDrop={
                    reorder
                      ? (e) => {
                          e.preventDefault()
                          const from = rows.findIndex((x) => reorder.rowId(x) === dragged.current)
                          if (from >= 0) moveTo(from, i)
                          dragged.current = null
                        }
                      : undefined
                  }
                >
                  {reorder && (
                    <Td className="w-8">
                      <button
                        type="button"
                        data-handle={reorder.rowId(r.original)}
                        draggable
                        aria-label={`Move ${reorder.rowLabel(r.original)}`}
                        title="Drag, or use the up and down arrow keys"
                        className="cursor-grab rounded-sm p-0.5 text-body hover:bg-soft"
                        onDragStart={(e) => {
                          dragged.current = reorder.rowId(r.original)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', dragged.current)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                            e.preventDefault()
                            refocus.current = reorder.rowId(r.original)
                            moveTo(i, e.key === 'ArrowUp' ? i - 1 : i + 1)
                          }
                        }}
                      >
                        <GripVertical className="size-4" aria-hidden />
                      </button>
                    </Td>
                  )}
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
