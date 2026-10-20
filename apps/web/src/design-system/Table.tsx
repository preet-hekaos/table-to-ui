import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react'
import { cn } from './cn'

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  )
}

export type SortDirection = 'asc' | 'desc'

/** A column header. When sortable it is a real button, so it works with the keyboard. */
export function Th({
  className,
  sortable,
  direction,
  onSort,
  children,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { sortable?: boolean; direction?: SortDirection | null; onSort?: () => void }) {
  const ariaSort = direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : sortable ? 'none' : undefined
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      className={cn('border-b border-line bg-canvas px-3 py-2 text-left text-[11px] font-semibold whitespace-nowrap text-muted', className)}
      {...props}
    >
      {sortable ? (
        <button type="button" onClick={onSort} className="inline-flex items-center gap-1 font-semibold hover:text-ink">
          {children}
          {direction === 'asc' ? <ArrowUp className="size-3" aria-hidden /> : direction === 'desc' ? <ArrowDown className="size-3" aria-hidden /> : <ChevronsUpDown className="size-3" aria-hidden />}
        </button>
      ) : (
        children
      )}
    </th>
  )
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('border-b border-soft px-3 py-2 whitespace-nowrap text-body', className)} {...props} />
}
