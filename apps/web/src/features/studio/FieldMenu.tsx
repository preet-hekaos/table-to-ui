import * as Popover from '@radix-ui/react-popover'
import { Eye, EyeOff, MoreHorizontal, PanelBottomOpen, Pencil } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { FieldDef } from '@/api/types'
import { Button, cn } from '@/design-system'
import { useSaveField } from './useSaveField'

/** The ⋯ menu of a row: show the details panel, open the full editor, hide the field from screens. */
export function FieldMenu({ table, field, expanded, onToggleDetails, onEdit }: { table: string; field: FieldDef; expanded: boolean; onToggleDetails: () => void; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const save = useSaveField(table, field.key, 'visibility')
  const item = (label: string, icon: ReactNode, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className={cn('flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-ink hover:bg-soft focus-visible:bg-soft focus-visible:outline-none')}
      onClick={() => { setOpen(false); run() }}
    >
      {icon}
      {label}
    </button>
  )
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button size="sm" variant="ghost" className="h-6 px-1.5" aria-label={`More actions for ${field.label}`}>
          <MoreHorizontal className="size-4" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={4} aria-label={`Actions for ${field.label}`} className="z-50 w-52 rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div role="menu" aria-label={`Actions for ${field.label}`}>
            {item(expanded ? 'Hide details' : 'Show details', <PanelBottomOpen className="size-4" aria-hidden />, onToggleDetails)}
            {item('Edit details', <Pencil className="size-4" aria-hidden />, onEdit)}
            {item(field.hidden ? 'Show on screens' : 'Hide from screens', field.hidden ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />, () => save.mutate({ hidden: !field.hidden }))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
