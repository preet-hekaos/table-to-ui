import { GripVertical, Sparkles } from 'lucide-react'
import { Fragment, useState, type KeyboardEvent } from 'react'
import type { FieldDef, StudioTable } from '@/api/types'
import { Badge, Button, Input, StageBadge, Table, Td, Th, cn, stageStripe } from '@/design-system'
import { FeaturesCell } from './FeaturesCell'
import { ExplainPanel } from './ExplainPanel'
import { FieldDetails } from './FieldDetails'
import { FieldMenu } from './FieldMenu'
import { InlineLabel } from './InlineLabel'
import { LengthCell } from './LengthCell'
import { RequiredSwitch } from './RequiredSwitch'
import { ValidationCell } from './ValidationCell'
import { ApplyToAll, TableWideBar } from './TableWideBar'
import { TransformCell } from './TransformCell'
import { TypeCell } from './TypeCell'
import { RemovedCount, UndoRemove } from './UndoRemove'
import { useFieldOrder } from './useFieldOrder'
import { useTableFeatures } from './useTableFeatures'
import type { useStages } from './useStages'

/** The Fields grid of the Studio (mockup board 1): one row per field, edited in place. */
export function FieldsGrid({
  table,
  tables,
  canEdit,
  stages,
  onEdit,
  onAddNew,
}: {
  table: StudioTable
  tables: StudioTable[]
  canEdit: boolean
  stages: ReturnType<typeof useStages>
  onEdit: (f: FieldDef) => void
  onAddNew: () => void
}) {
  const { move, note } = useFieldOrder(table)
  const { features, patch } = useTableFeatures(table)
  const [find, setFind] = useState('')
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [explainKey, setExplainKey] = useState<string | null>(null)
  const explained = table.fields.find((f) => f.key === explainKey)
  const toggle = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const keys = table.fields.map((f) => f.key)

  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    const i = keys.indexOf(key)
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(key, i - 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(key, i + 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      move(key, 0)
    } else if (e.key === 'End') {
      e.preventDefault()
      move(key, keys.length - 1)
    }
  }

  const q = find.trim().toLowerCase()
  const shownFields = q ? table.fields.filter((f) => f.key.toLowerCase().includes(q) || f.label.toLowerCase().includes(q)) : table.fields

  return (
    <div className="overflow-x-auto">
      <p className="sr-only" role="status" aria-live="polite">{note}</p>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
        <Input aria-label="Search fields" placeholder="Search fields" className="h-8 w-56" value={find} onChange={(e) => setFind(e.target.value)} />
        {canEdit && <span className="ml-auto"><ApplyToAll features={features} /></span>}
        <TableWideBar table={table} canEdit={canEdit} features={features} patch={patch} />
      </div>
      <Table aria-label={`${table.label} fields`}>
        <thead>
          <tr>
            {canEdit && <Th className="w-8"><span className="sr-only">Move</span></Th>}
            <Th>Field name</Th>
            <Th>Label</Th>
            <Th>Type</Th>
            <Th>Core type</Th>
            <Th>Length</Th>
            <Th>Validation</Th>
            <Th>Required</Th>
            <Th>Features</Th>
            <Th>Transformation rule</Th>
            {canEdit && <Th><span className="sr-only">Actions</span></Th>}
          </tr>
        </thead>
        <tbody>
          {shownFields.map((f) => {
            const stage = stages.field(table.key, f.key)
            return (
              <Fragment key={f.key}>
              <tr
                className={cn('group', stageStripe(stage), dragKey && overKey === f.key && dragKey !== f.key && 'shadow-[inset_0_2px_0_0_var(--color-accent,#1d4fd7)]')}
                data-stage={stage}
                onDragOver={canEdit && dragKey ? (e) => { e.preventDefault(); setOverKey(f.key) } : undefined}
                onDrop={
                  canEdit && dragKey
                    ? (e) => {
                        e.preventDefault()
                        if (dragKey !== f.key) move(dragKey, keys.indexOf(f.key))
                        setDragKey(null)
                        setOverKey(null)
                      }
                    : undefined
                }
              >
                {canEdit && (
                  <Td className="w-8 py-1.5">
                    <button
                      type="button"
                      draggable
                      aria-label={`Move ${f.label}. Drag, or use the up and down arrow keys.`}
                      title="Drag to reorder"
                      className="cursor-grab rounded p-0.5 text-muted hover:bg-soft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      onKeyDown={(e) => onHandleKey(e, f.key)}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('text/plain', f.key)
                        setDragKey(f.key)
                      }}
                      onDragEnd={() => { setDragKey(null); setOverKey(null) }}
                    >
                      <GripVertical className="size-4" aria-hidden />
                    </button>
                  </Td>
                )}
                <Td className="py-1.5 font-mono text-xs text-muted">{f.key}</Td>
                <Td className="py-1.5 font-medium text-ink">
                  <InlineLabel table={table} field={f} canEdit={canEdit} /> {stage && stage !== 'live' && <StageBadge stage={stage} className="ml-1" />}
                  {f.hidden && <Badge tone="warn" className="ml-1">Hidden</Badge>}
                </Td>
                <Td className="py-1.5">
                  <TypeCell table={table} tables={tables} field={f} canEdit={canEdit} onAddNew={onAddNew} />
                </Td>
                <Td className="py-1.5">
                  <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-xs text-body">{f.type}</code>
                </Td>
                <Td className="py-1.5">
                  <LengthCell table={table} field={f} canEdit={canEdit} />
                </Td>
                <Td className="py-1.5">
                  <ValidationCell table={table} field={f} canEdit={canEdit} />
                </Td>
                <Td className="py-1.5">
                  <RequiredSwitch table={table} field={f} canEdit={canEdit} />
                  <span className="sr-only">{f.required ? 'Yes' : 'No'}</span>
                </Td>
                <Td className="py-1.5">
                  <FeaturesCell table={table} field={f} f={features} patch={patch} canEdit={canEdit} />
                </Td>
                <Td className="py-1.5">
                  <TransformCell table={table} field={f} canEdit={canEdit} />
                </Td>
                {canEdit && (
                  <Td className="py-1.5"><div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-violet-800 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:hidden" onClick={() => setExplainKey(f.key)} aria-label={`Explain ${f.label}`}>
                      <Sparkles className="size-3.5" aria-hidden /> Explain
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => onEdit(f)} aria-label={`Edit ${f.label}`}>
                      Edit
                    </Button>
                    <FieldMenu table={table.key} field={f} expanded={open.has(f.key)} onToggleDetails={() => toggle(f.key)} onEdit={() => onEdit(f)} onExplain={() => setExplainKey(f.key)} />
                  </div></Td>
                )}
              </tr>
              {open.has(f.key) && (
                <tr data-details-of={f.key}>
                  <Td colSpan={canEdit ? 11 : 9} className="p-0">
                    <FieldDetails table={table} tables={tables} field={f} canEdit={canEdit} />
                  </Td>
                </tr>
              )}
              </Fragment>
            )
          })}
          {stages.removedFields(table.key).map((f) => (
            <tr key={`removed-${f.key}`} className={cn(stageStripe('removed'), 'text-muted')} data-stage="removed">
              {canEdit && <Td />}
              <Td className="font-mono text-xs line-through">{f.key}</Td>
              <Td>
                <span className="line-through">{f.label}</span> <StageBadge stage="removed" className="ml-1 no-underline" />
              </Td>
              <Td colSpan={canEdit ? 8 : 7} className="whitespace-normal">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>Deleted in the Draft; goes away when published.</span>
                  <RemovedCount table={table.key} fieldKey={f.key} />
                  {canEdit && <UndoRemove table={table.key} fieldKey={f.key} label={f.label} />}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {explained && <ExplainPanel table={table} tables={tables} field={explained} stage={stages.field(table.key, explained.key)} canEdit={canEdit} onClose={() => setExplainKey(null)} onEdit={() => onEdit(explained)} />}
      <p className="flex flex-wrap justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
        <span>{table.fields.length} fields{canEdit && ' · changes save to the Draft as you edit'}</span>
        {canEdit && <span className="font-mono">Enter save · Esc cancel · Arrows on the handle move a field</span>}
      </p>
    </div>
  )
}
