import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, FileDown, FileUp, MoreHorizontal, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Button, StageDot, cn } from '@/design-system'

type Stage = Parameters<typeof StageDot>[0]['stage']

interface Item {
  key: string
  label: string
  fields: number
  stage?: Stage
}

const panel = 'z-50 rounded-lg border border-line bg-surface p-1 shadow-lg'

/** Pick the table to work on: a searchable list that opens from the table's name. */
export function TablePicker({ items, current, onSelect }: { items: Item[]; current?: Item; onSelect: (k: string) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const shown = items.filter((t) => t.label.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ('') }}>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Table: ${current?.label ?? 'none'}. Change table`} className="min-w-44 justify-between">
          <span className="flex items-center gap-2 font-semibold">
            {current?.stage && <StageDot stage={current.stage} />}
            {current?.label ?? 'Choose a table'}
          </span>
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={cn(panel, 'w-72')}>
          <div className="relative p-1">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <input
              autoFocus
              aria-label="Search tables"
              placeholder="Search tables"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 w-full rounded-md border border-line bg-surface pr-2 pl-8 text-sm text-ink"
            />
          </div>
          <nav aria-label="Tables">
            <ul className="mt-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto">
              {shown.map((t) => (
                <li key={t.key}>
                  <button
                    type="button"
                    aria-current={t.key === current?.key ? 'true' : undefined}
                    onClick={() => { onSelect(t.key); setOpen(false) }}
                    className={cn('flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm', t.key === current?.key ? 'bg-accent-soft font-semibold text-accent-ink' : 'text-body hover:bg-soft')}
                  >
                    <span className="flex items-center gap-2">
                      {t.stage && <StageDot stage={t.stage} />}
                      {t.label}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-muted">
                      {t.fields} fields
                      {t.key === current?.key && <Check className="size-4" aria-hidden />}
                    </span>
                  </button>
                </li>
              ))}
              {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">No table matches "{q}".</li>}
            </ul>
          </nav>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The table-level actions: New table up front, the rarer schema actions in a small menu. */
export function TableActions({ canEdit, onNew, onImport, onExport }: { canEdit: boolean; onNew: () => void; onImport: () => void; onExport: () => void }) {
  const [open, setOpen] = useState(false)
  const item = (label: string, icon: React.ReactNode, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => { setOpen(false); run() }}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-body hover:bg-soft"
    >
      {icon}
      {label}
    </button>
  )
  return (
    <div className="flex items-center gap-2">
      {canEdit && (
        <Button variant="primary" size="sm" onClick={onNew}>
          <Plus className="size-4" aria-hidden /> New table
        </Button>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="secondary" size="sm" aria-label="More table actions">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} className={cn(panel, 'w-48')}>
            <div role="menu" aria-label="More table actions">
              {canEdit && item('Import schema', <FileUp className="size-4" aria-hidden />, onImport)}
              {item('Export schema', <FileDown className="size-4" aria-hidden />, onExport)}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
