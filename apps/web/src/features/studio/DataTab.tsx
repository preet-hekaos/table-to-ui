import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import type { FieldDef, StudioTable } from '@/api/types'
import { Badge, Button, Card, ErrorState, LoadingState, StageBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/design-system'
import { FieldDialog, NewTableDialog } from './FieldDialog'
import { FieldsGrid } from './FieldsGrid'
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
            <FieldsGrid table={current as StudioTable} tables={all} canEdit={canEdit} stages={stages} onEdit={setEditing} onAddNew={() => setEditing('new')} />
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
