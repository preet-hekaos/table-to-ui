import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Select } from '@/design-system'

export const PAGE_SIZES = [15, 25, 50, 100]

/** Which page numbers to show: first, last, the current one and its neighbours; `null` marks a gap. */
export function pageWindow(page: number, pages: number): (number | null)[] {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))
  const out: (number | null)[] = []
  let last = 0
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last > 1) out.push(null)
    out.push(n)
    last = n
  }
  return out
}

/** The foot of a table card: how many to show per page, which rows these are, and page buttons. */
export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  noun,
}: {
  total: number
  page: number
  pageSize: number
  onPage: (n: number) => void
  onPageSize: (n: number) => void
  noun: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const btn = 'inline-flex size-8 items-center justify-center rounded-md text-body hover:bg-soft disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-line bg-canvas px-3 py-2 text-xs text-body" data-testid="pagination">
      <label className="flex items-center gap-2">
        Rows per page
        <Select aria-label="Rows per page" className="h-8 w-20" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </Select>
      </label>
      <p role="status" aria-live="polite" data-testid="page-range">
        Showing {from.toLocaleString('en-IN')} to {to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')} {noun}
      </p>
      <nav aria-label="Pages" className="ml-auto flex items-center gap-0.5">
        <button type="button" className={btn} aria-label="First page" disabled={page <= 1} onClick={() => onPage(1)}><ChevronsLeft className="size-4" aria-hidden /></button>
        <button type="button" className={btn} aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="size-4" aria-hidden /></button>
        {pageWindow(page, pages).map((n, i) =>
          n === null ? (
            <span key={`gap${i}`} aria-hidden className="px-1 text-muted">…</span>
          ) : (
            <button
              key={n}
              type="button"
              className={`${btn} min-w-8 px-1 font-semibold ${n === page ? 'bg-accent text-white hover:bg-accent' : ''}`}
              aria-label={`Page ${n}`}
              aria-current={n === page ? 'page' : undefined}
              onClick={() => onPage(n)}
            >
              {n}
            </button>
          ),
        )}
        <button type="button" className={btn} aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="size-4" aria-hidden /></button>
        <button type="button" className={btn} aria-label="Last page" disabled={page >= pages} onClick={() => onPage(pages)}><ChevronsRight className="size-4" aria-hidden /></button>
      </nav>
    </div>
  )
}
