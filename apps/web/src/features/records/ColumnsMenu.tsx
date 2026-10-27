import * as Popover from '@radix-ui/react-popover'
import { Columns3 } from 'lucide-react'
import { Button } from '@/design-system'

export interface ColumnChoice {
  key: string
  label: string
  /** The title column stays; it is the link to the record. */
  locked?: boolean
}

/** Show or hide columns for this person only. The owner's choices (hidden fields) are not offered here. */
export function ColumnsMenu({ columns, hidden, onChange, onReset }: { columns: ColumnChoice[]; hidden: string[]; onChange: (hidden: string[]) => void; onReset: () => void }) {
  const off = new Set(hidden)
  const flip = (k: string) => onChange(off.has(k) ? hidden.filter((x) => x !== k) : [...hidden, k])
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm" aria-label="Columns">
          <Columns3 className="size-4" aria-hidden /> Columns{hidden.length > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] text-white">{hidden.length} hidden</span>}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-64 rounded-lg border border-line bg-surface p-2 shadow-lg">
          <fieldset className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            <legend className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Columns shown</legend>
            {columns.map((c) => (
              <label key={c.key} className="flex min-h-8 items-center gap-2 rounded-md px-2 text-sm text-body hover:bg-soft">
                <input type="checkbox" className="size-4" checked={!off.has(c.key)} disabled={c.locked} onChange={() => flip(c.key)} />
                {c.label}
              </label>
            ))}
          </fieldset>
          <div className="mt-1 flex justify-end border-t border-line pt-2">
            <Button size="sm" variant="ghost" onClick={onReset} disabled={hidden.length === 0}>Reset to default</Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
