import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Link } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Badge, Button, StageBadge } from '@/design-system'
import { TYPE_LABELS } from '../FieldDialog'
import { useStages } from '../useStages'

/** Everything about one table, beside the canvas: fields, links in and out, and the next steps. */
export function TableDrawer({
  table,
  all,
  links,
  canEdit,
  focus,
  onFocus,
  onClose,
  onEditLink,
  onAddLink,
  onOpenFields,
  onSelect,
}: {
  table: StudioTable
  all: StudioTable[]
  links: Link[]
  canEdit: boolean
  focus: boolean
  onFocus: (on: boolean) => void
  onClose: () => void
  onEditLink: (l: Link) => void
  onAddLink: (table: string) => void
  onOpenFields: (table: string) => void
  onSelect: (table: string) => void
}) {
  const stages = useStages()
  const stage = stages.of('tables', table.key)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [table.key])
  const label = (k: string) => all.find((t) => t.key === k)?.label ?? k
  const out = links.filter((l) => l.table === table.key)
  const into = links.filter((l) => l.to === table.key && l.table !== table.key)
  const fields = table.fields.filter((f) => !f.hidden)
  const row = (l: Link, other: string) => (
    <li key={l.id} className="flex items-center justify-between gap-2" data-testid={`drawer-link-${l.id}`}>
      <span className="min-w-0 truncate">
        <button type="button" className="font-semibold text-accent-ink hover:underline" onClick={() => onSelect(other)}>
          {label(other)}
        </button>{' '}
        <span className="text-muted">({l.label}
          {l.required ? ', required' : ''}
          {l.hidden ? ', hidden' : ''})</span>
      </span>
      {canEdit && (
        <Button size="sm" variant="ghost" onClick={() => onEditLink(l)} aria-label={`Edit link ${l.label} on ${l.table_label}`}>
          Edit
        </Button>
      )}
    </li>
  )
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      aria-label={`${table.label} details`}
      data-testid="table-drawer"
      className="absolute inset-y-0 right-0 z-10 flex w-full max-w-sm flex-col gap-3 overflow-y-auto border-l border-line bg-surface p-4 shadow-lg outline-none"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-ink">{table.label}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={table.source === 'pack' ? 'accent' : 'neutral'}>{table.source === 'pack' ? 'Pack' : 'Workspace'}</Badge>
            {stage && <StageBadge stage={stage} isNew={stages.isNew('tables', table.key)} />}
            <Badge>{fields.length} fields</Badge>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close details">
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button size="sm" variant="primary" onClick={() => onAddLink(table.key)}>
            Add link
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => onOpenFields(table.key)}>
          Open {table.label} fields
        </Button>
        <label className="ml-auto flex items-center gap-2 text-xs text-body">
          <input type="checkbox" checked={focus} onChange={(e) => onFocus(e.target.checked)} /> Focus on this table
        </label>
      </div>

      <section aria-label="Links out">
        <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Points to ({out.length})</h3>
        {out.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : <ul className="mt-1 flex flex-col gap-1 text-sm">{out.map((l) => row(l, l.to))}</ul>}
      </section>
      <section aria-label="Links in">
        <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Pointed to by ({into.length})</h3>
        {into.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : <ul className="mt-1 flex flex-col gap-1 text-sm">{into.map((l) => row(l, l.table))}</ul>}
      </section>
      <section aria-label="Fields">
        <h3 className="text-xs font-bold tracking-wide text-muted uppercase">Fields</h3>
        <ul className="mt-1 flex flex-col divide-y divide-line text-sm">
          {fields.map((f) => (
            <li key={f.key} className="flex items-center justify-between gap-2 py-1">
              <span className="truncate text-ink">{f.label}</span>
              <span className="shrink-0 text-xs text-muted">
                {TYPE_LABELS[f.type] ?? f.type}
                {f.ref_table ? ` to ${label(f.ref_table)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
