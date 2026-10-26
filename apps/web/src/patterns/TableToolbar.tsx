import type { ReactNode } from 'react'

/** The slim bar above a table: what is shown on the left, tools on the right. Tools arrive with each table feature. */
export function TableToolbar({ summary, children }: { summary: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-2 text-sm" data-testid="table-toolbar">
      <p className="text-muted">{summary}</p>
      {children && <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}
