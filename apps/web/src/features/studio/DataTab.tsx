import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { FieldDef, StudioTable } from '@/api/types'
import { Badge, Button, Card, ErrorState, LoadingState, Table, Td, Th, cn } from '@/design-system'
import { FieldDialog, NewTableDialog, TYPE_LABELS } from './FieldDialog'

const origin = (s?: string) => <Badge tone={s === 'agency' ? 'neutral' : 'accent'}>{s === 'agency' ? 'Workspace' : 'Pack'}</Badge>

export function useDraftTables() {
  return useQuery({ queryKey: ['studio-tables'], queryFn: studio.tables, retry: false })
}

/** Screen 2.4: tables on the left, the chosen table's fields on the right. */
export function DataTab({ selected, onSelect, canEdit, defaultTable }: { selected?: string; onSelect: (k: string) => void; canEdit: boolean; defaultTable?: string }) {
  const tables = useDraftTables()
  const [editing, setEditing] = useState<FieldDef | 'new' | null>(null)
  const [newTable, setNewTable] = useState(false)
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
                <span>{t.label}</span>
                <span className={cn('text-xs', t.key === current?.key ? 'text-accent-ink' : 'text-muted')}>{t.fields.length}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {current && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <h2 className="text-sm font-bold text-ink">{current.label}</h2>
            {origin(current.source)}
            <Badge>{current.fields.length} fields</Badge>
            {canEdit && (
              <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEditing('new')}>
                <Plus className="size-4" aria-hidden /> Add field
              </Button>
            )}
          </div>
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
                  <tr key={f.key}>
                    <Td className="font-semibold text-ink">{f.label}</Td>
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
              </tbody>
            </Table>
          </div>
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
    </div>
  )
}
