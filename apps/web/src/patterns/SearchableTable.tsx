import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
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
}) {
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel(), manualSorting: true })
  return (
    <div className="flex flex-col gap-3">
      <Table aria-label={caption}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <Th
                  key={h.id}
                  sortable={sortableKeys.has(h.column.id)}
                  direction={sort.key === h.column.id ? sort.direction : null}
                  onSort={() => onSort(h.column.id)}
                >
                  {flexRender(h.column.columnDef.header, h.getContext())}
                </Th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} className="hover:bg-canvas">
              {r.getVisibleCells().map((c) => (
                <Td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</Td>
              ))}
            </tr>
          ))}
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
