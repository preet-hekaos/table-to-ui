import { FileUp, Plus } from 'lucide-react'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import type { FieldDef, StudioTable } from '@/api/types'
import { Badge, Button, Card, ErrorState, LoadingState, StageBadge, StageDot, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th, cn, stageStripe } from '@/design-system'
import { FieldDialog, NewTableDialog, TYPE_LABELS } from './FieldDialog'
import { SchemaImportDialog } from './SchemaImportDialog'
import { ScreensTab } from './ScreensTab'
import { useDraftTables } from './useDraftTables'
import { useStages } from './useStages'

const origin = (s?: string) => <Badge tone={s === 'agency' ? 'neutral' : 'accent'}>{s === 'agency' ? 'Workspace' : 'Pack'}</Badge>


/** Screen 2.4: tables on the left, the chosen table's fields on the right. */
export type TablePart = 'fields' | 'screens'

export function DataTab({
  selected,
  onSelect,
  canEdit,
  defaultTable,
  part = 'fields',
  onPart,
}: {
  selected?: string
  onSelect: (k: string) => void
  canEdit: boolean
  defaultTable?: string
  part?: TablePart
  onPart: (p: TablePart) => void
}) {
  const tables = useDraftTables()
  const [editing, setEditing] = useState<FieldDef | 'new' | null>(null)
  const [newTable, setNewTable] = useState(false)
  const [importing, setImporting] = useState(false)
  const stages = useStages()
  if (tables.isLoading) return <LoadingState label="Loading tables" />
  if (tables.isError) return <ErrorState requestId={(tables.error as ApiError).requestId} onRetry={() => void tables.refetch()} />
  const all = tables.data ?? []
  const current = all.find((t) => t.key === (selected ?? defaultTable)) ?? all[0]
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[15rem_minmax(0,1fr)]">
      <nav aria-label="Tables" className="flex flex-col gap-1">
        {canEdit && (
          <Button variant="secondary" size="sm" className="mb-2 justify-start" onClick={() => setNewTable(true)}>
            <Plus className="size-4" aria-hidden /> New table
          </Button>
        )}
        {canEdit && (
          <Button variant="secondary" size="sm" className="mb-2 justify-start border-dashed" onClick={() => setImporting(true)}>
            <FileUp className="size-4" aria-hidden /> Import schema
          </Button>
        )}
        <ul className="flex max-h-[60vh] flex-col gap-0.5 overflow-y-auto">
          {all.map((t) => (
            <li key={t.key}>
              <button
                type="button"
                aria-current={t.key === current?.key ? 'true' : undefined}
                onClick={() => onSelect(t.key)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm',
                  t.key === current?.key ? 'bg-accent-soft font-semibold text-accent-ink' : 'text-body hover:bg-soft',
                )}
              >
                <span className="flex items-center gap-2">
                  {stages.of('tables', t.key) && <StageDot stage={stages.of('tables', t.key)!} />}
                  {t.label}
                </span>
                <span className={cn('text-xs', t.key === current?.key ? 'text-accent-ink' : 'text-muted')}>{t.fields.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {current && (
        <Card className="p-0">
          <Tabs value={part} onValueChange={(v) => onPart(v as TablePart)}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <h2 className="text-sm font-bold text-ink">{current.label}</h2>
            {origin(current.source)}
            {stages.of('tables', current.key) && <StageBadge stage={stages.of('tables', current.key)!} isNew={stages.isNew('tables', current.key)} />}
            <Badge>{current.fields.length} fields</Badge>
            {canEdit && part === 'fields' && (
              <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEditing('new')}>
                <Plus className="size-4" aria-hidden /> Add field
              </Button>
            )}
          </div>
          <TabsList aria-label={`${current.label} parts`} className="px-3">
            <TabsTrigger value="fields">Fields</TabsTrigger>
            <TabsTrigger value="screens">Screens</TabsTrigger>
          </TabsList>
          <TabsContent value="fields">
          <div className="overflow-x-auto">
            <Table aria-label={`${current.label} fields`}>
              <thead>
                <tr>
                  <Th>Field</Th>
                  <Th>Type</Th>
                  <Th>Required</Th>
                  <Th>Comes from</Th>
                  <Th>On screens</Th>
                  {canEdit && <Th><span className="sr-only">Actions</span></Th>}
                </tr>
              </thead>
              <tbody>
                {current.fields.map((f) => (
                  <tr key={f.key} className={cn(stageStripe(stages.field(current.key, f.key)))} data-stage={stages.field(current.key, f.key)}>
                    <Td className="font-semibold text-ink">
                      {f.label} {stages.field(current.key, f.key) && stages.field(current.key, f.key) !== 'live' && <StageBadge stage={stages.field(current.key, f.key)!} className="ml-1" />}
                    </Td>
                    <Td>
                      {TYPE_LABELS[f.type] ?? f.type}
                      {f.ref_table && <span className="text-muted"> to {all.find((t) => t.key === f.ref_table)?.label ?? f.ref_table}</span>}
                    </Td>
                    <Td>{f.required ? 'Yes' : 'No'}</Td>
                    <Td>{origin(f.source)}</Td>
                    <Td>{f.hidden ? <Badge tone="warn">Hidden</Badge> : 'Shown'}</Td>
                    {canEdit && (
                      <Td>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(f)} aria-label={`Edit ${f.label}`}>
                          Edit
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
                {stages.removedFields(current.key).map((f) => (
                  <tr key={`removed-${f.key}`} className={cn(stageStripe('removed'), 'text-muted line-through')} data-stage="removed">
                    <Td>
                      {f.label} <StageBadge stage="removed" className="ml-1 no-underline" />
                    </Td>
                    <Td colSpan={canEdit ? 5 : 4}>Deleted in the Draft; goes away when published.</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          </TabsContent>
          <TabsContent value="screens" className="p-3">
            <ScreensTab canEdit={canEdit} tableKey={current.key} />
          </TabsContent>
          </Tabs>
        </Card>
      )}
      {current && editing && (
        <FieldDialog
          key={editing === 'new' ? 'new' : editing.key}
          table={current as StudioTable}
          tables={all}
          field={editing === 'new' ? undefined : editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
        />
      )}
      {newTable && <NewTableDialog open onOpenChange={setNewTable} onCreated={onSelect} />}
      {importing && <SchemaImportDialog open onOpenChange={setImporting} onCreated={onSelect} />}
    </div>
  )
}
