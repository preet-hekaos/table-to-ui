import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import type { FieldDef, StudioTable } from '@/api/types'
import { Badge, Button, Card, ErrorState, LoadingState, StageBadge, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th, cn, stageStripe } from '@/design-system'
import { FieldDialog, NewTableDialog, TYPE_LABELS } from './FieldDialog'
import { FeaturesPanel } from './FeaturesPanel'
import { SchemaExportDialog } from './SchemaExportDialog'
import { SchemaImportDialog } from './SchemaImportDialog'
import { ScreensTab } from './ScreensTab'
import { TableActions, TablePicker } from './TablePicker'
import { useDraftTables } from './useDraftTables'
import { useStages } from './useStages'


/** Screen 2.4: pick a table from the header; its fields, screens and features sit below. */
export type TablePart = 'fields' | 'screens' | 'features'

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
  const [exporting, setExporting] = useState(false)
  const stages = useStages()
  if (tables.isLoading) return <LoadingState label="Loading tables" />
  if (tables.isError) return <ErrorState requestId={(tables.error as ApiError).requestId} onRetry={() => void tables.refetch()} />
  const all = tables.data ?? []
  const current = all.find((t) => t.key === (selected ?? defaultTable)) ?? all[0]
  return (
    <div className="flex flex-col gap-4">
      {current && (
        <Card className="p-0">
          <Tabs value={part} onValueChange={(v) => onPart(v as TablePart)}>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <h2 className="sr-only">{current.label}</h2>
            <TablePicker
              items={all.map((t) => ({ key: t.key, label: t.label, fields: t.fields.length, stage: stages.of('tables', t.key) ?? undefined }))}
              current={{ key: current.key, label: current.label, fields: current.fields.length, stage: stages.of('tables', current.key) ?? undefined }}
              onSelect={onSelect}
            />
            {stages.of('tables', current.key) && <StageBadge stage={stages.of('tables', current.key)!} isNew={stages.isNew('tables', current.key)} />}
            <Badge>{current.fields.length} fields</Badge>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <TabsList aria-label={`${current.label} parts`} className="gap-0.5 overflow-visible rounded-lg border border-line bg-soft p-0.5">
                {(['fields', 'screens', 'features'] as const).map((v) => (
                  <TabsTrigger key={v} value={v} className="m-0 rounded-md border-0 px-3 py-1 capitalize text-body hover:bg-surface data-[state=active]:bg-surface data-[state=active]:shadow-sm">
                    {v}
                  </TabsTrigger>
                ))}
              </TabsList>
              <span className="h-6 w-px bg-line" aria-hidden />
              {canEdit && part === 'fields' && (
                <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
                  <Plus className="size-4" aria-hidden /> Add field
                </Button>
              )}
              <TableActions canEdit={canEdit} onNew={() => setNewTable(true)} onImport={() => setImporting(true)} onExport={() => setExporting(true)} />
            </div>
          </div>
          <TabsContent value="fields">
          <div className="overflow-x-auto">
            <Table aria-label={`${current.label} fields`}>
              <thead>
                <tr>
                  <Th>Field name</Th>
                  <Th>Label</Th>
                  <Th>Type</Th>
                  <Th>Required</Th>
                  {canEdit && <Th><span className="sr-only">Actions</span></Th>}
                </tr>
              </thead>
              <tbody>
                {current.fields.map((f) => {
                  const stage = stages.field(current.key, f.key)
                  return (
                    <tr key={f.key} className={cn(stageStripe(stage))} data-stage={stage}>
                      <Td className="py-1.5 font-mono text-xs text-muted">{f.key}</Td>
                      <Td className="py-1.5 font-medium text-ink">
                        {f.label} {stage && stage !== 'live' && <StageBadge stage={stage} className="ml-1" />}
                        {f.hidden && <Badge tone="warn" className="ml-1">Hidden</Badge>}
                      </Td>
                      <Td className="py-1.5">
                        {TYPE_LABELS[f.type] ?? f.type}
                        {f.ref_table && <span className="text-muted"> to {all.find((t) => t.key === f.ref_table)?.label ?? f.ref_table}</span>}
                      </Td>
                      <Td className="py-1.5">{f.required ? 'Yes' : 'No'}</Td>
                      {canEdit && (
                        <Td className="py-1.5 text-right">
                          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing(f)} aria-label={`Edit ${f.label}`}>
                            Edit
                          </Button>
                        </Td>
                      )}
                    </tr>
                  )
                })}
                {stages.removedFields(current.key).map((f) => (
                  <tr key={`removed-${f.key}`} className={cn(stageStripe('removed'), 'text-muted line-through')} data-stage="removed">
                    <Td className="font-mono text-xs">{f.key}</Td>
                    <Td>
                      {f.label} <StageBadge stage="removed" className="ml-1 no-underline" />
                    </Td>
                    <Td colSpan={canEdit ? 3 : 2}>Deleted in the Draft; goes away when published.</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
          </TabsContent>
          <TabsContent value="screens" className="p-3">
            <ScreensTab canEdit={canEdit} tableKey={current.key} />
          </TabsContent>
          <TabsContent value="features" className="p-3">
            <FeaturesPanel key={`${current.key}-${current.version}-${JSON.stringify(current.features ?? null)}`} table={current as StudioTable} canEdit={canEdit} />
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
      {exporting && <SchemaExportDialog open onOpenChange={setExporting} tables={all.map((t) => ({ key: t.key, label: t.label }))} />}
    </div>
  )
}
