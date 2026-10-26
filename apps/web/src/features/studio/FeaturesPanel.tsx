import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Badge, Button, Select, useToast } from '@/design-system'
import { ACTIVE_FEATURES, DEFAULT_FEATURES, featuresOf, type TableFeatures } from './features'

type Group<K extends keyof TableFeatures> = { value: TableFeatures[K] extends (infer U)[] ? U : never; label: string }

const BULK: Group<'bulk_actions'>[] = [
  { value: 'export', label: 'Export' },
  { value: 'edit', label: 'Change a field value' },
  { value: 'delete', label: 'Delete (with Undo)' },
]
const FORMATS: Group<'export_formats'>[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'xlsx', label: 'Excel' },
]

interface Item {
  key: keyof TableFeatures
  title: string
  help: string
}
const ITEMS: Item[] = [
  { key: 'sort_filter', title: 'Sort and filter', help: 'Click a column heading to sort, and filter by any shown field.' },
  { key: 'select_bulk', title: 'Select rows and act on many', help: 'Tick rows, a whole page or every match, then export, change a value or delete.' },
  { key: 'import_data', title: 'Import data', help: 'Bring in CSV, JSON or Excel files from the table toolbar.' },
  { key: 'export_data', title: 'Export data', help: 'Download rows, or send them as a link by email.' },
  { key: 'inline_edit', title: 'Edit in the list', help: 'Double-click a cell to change it without opening the record.' },
  { key: 'grouping', title: 'Group rows', help: 'Group by a field, with headings that open and close.' },
  { key: 'statistics', title: 'Numbers above the table', help: 'Totals and averages that follow the current filters.' },
  { key: 'row_order', title: 'Drag to reorder', help: 'Move a record up or down; the order is shared by everyone.' },
]

/** Per-table switches for the classic table features. All on until the owner changes them. */
export function FeaturesPanel({ table, canEdit }: { table: StudioTable; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const saved = featuresOf(table)
  const [f, setF] = useState<TableFeatures>(saved)
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)
  const set = <K extends keyof TableFeatures>(k: K, v: TableFeatures[K]) => setF((x) => ({ ...x, [k]: v }))
  const toggle = <V extends string>(list: V[], v: V, on: boolean): V[] => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))

  const done = async (title: string, description: string) => {
    toast({ title, description, tone: 'ok' })
    await Promise.all(['studio-tables', 'studio-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  }
  const save = useMutation({
    mutationFn: () => studio.setFeatures(table.key, f),
    onSuccess: () => done(`Saved features for ${table.label}`, 'Saved in Draft. Publish to make it live.'),
  })
  const all = useMutation({
    mutationFn: () => studio.setAllFeatures(f),
    onSuccess: (r) => done('Applied to every table', `${r.tables.length} ${r.tables.length === 1 ? 'table' : 'tables'} changed in Draft.`),
  })

  return (
    <div className="flex flex-col gap-4" data-testid="features-panel">
      <p className="text-sm text-muted">
        Every table gets these features. Switch off what this table does not need. Changes stay in Draft until you publish.
      </p>
      <ul className="divide-y divide-line rounded-lg border border-line" aria-label={`Features of ${table.label}`}>
        {ITEMS.map((it) => (
          <li key={it.key} className="flex flex-col gap-2 p-3">
            <label className="flex flex-wrap items-center gap-3">
              <input
                type="checkbox"
                role="switch"
                className="size-4"
                checked={f[it.key] as boolean}
                disabled={!canEdit}
                onChange={(e) => set(it.key, e.target.checked as never)}
              />
              <span className="text-sm font-semibold text-ink">{it.title}</span>
              {!ACTIVE_FEATURES.has(it.key) && <Badge>Takes effect in an upcoming update</Badge>}
            </label>
            <p className="pl-7 text-xs text-muted">{it.help}</p>
            {it.key === 'sort_filter' && f.sort_filter && (
              <div className="flex flex-col gap-2 pl-7">
                <label className="flex items-center gap-2 text-xs text-body">
                  Default order
                  <Select
                    aria-label="Default order"
                    className="w-64"
                    disabled={!canEdit}
                    value={f.default_sort ? `${f.default_sort.field}:${f.default_sort.direction}` : ''}
                    onChange={(e) => {
                      const [field, direction] = e.target.value.split(':')
                      set('default_sort', e.target.value ? { field: field!, direction: direction as 'asc' | 'desc' } : null)
                    }}
                  >
                    <option value="">Recently changed first</option>
                    {table.fields.filter((x) => x.type !== 'long_text').flatMap((x) => [
                      <option key={`${x.key}:asc`} value={`${x.key}:asc`}>{x.label}, A to Z / low to high</option>,
                      <option key={`${x.key}:desc`} value={`${x.key}:desc`}>{x.label}, Z to A / high to low</option>,
                    ])}
                  </Select>
                </label>
                <table className="text-xs text-body" aria-label="Fields that can be sorted or filtered">
                  <thead><tr><th className="pr-4 text-left font-semibold">Field</th><th className="pr-4 text-left font-semibold">Sort</th><th className="text-left font-semibold">Filter</th></tr></thead>
                  <tbody>
                    {table.fields.map((x) => (
                      <tr key={x.key}>
                        <td className="pr-4">{x.label}</td>
                        <td className="pr-4">
                          <input type="checkbox" className="size-6" aria-label={`Sort by ${x.label}`} disabled={!canEdit || x.type === 'long_text'} checked={x.type !== 'long_text' && !f.unsortable.includes(x.key)} onChange={(e) => set('unsortable', toggle(f.unsortable, x.key, !e.target.checked))} />
                        </td>
                        <td>
                          <input type="checkbox" className="size-6" aria-label={`Filter by ${x.label}`} disabled={!canEdit} checked={!f.unfilterable.includes(x.key)} onChange={(e) => set('unfilterable', toggle(f.unfilterable, x.key, !e.target.checked))} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {it.key === 'select_bulk' && f.select_bulk && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
                <fieldset className="flex flex-wrap gap-x-3" disabled={!canEdit}>
                  <legend className="sr-only">Bulk actions allowed</legend>
                  {BULK.map((b) => (
                    <label key={b.value} className="flex items-center gap-1 text-xs text-body">
                      <input type="checkbox" checked={f.bulk_actions.includes(b.value)} onChange={(e) => set('bulk_actions', toggle(f.bulk_actions, b.value, e.target.checked))} /> {b.label}
                    </label>
                  ))}
                </fieldset>
                <label className="flex items-center gap-2 text-xs text-body">
                  Bulk actions include
                  <Select aria-label="Bulk actions include" className="w-56" disabled={!canEdit} value={f.bulk_scope} onChange={(e) => set('bulk_scope', e.target.value as TableFeatures['bulk_scope'])}>
                    <option value="view">Shown columns only</option>
                    <option value="all">Every field</option>
                  </Select>
                </label>
              </div>
            )}
            {it.key === 'export_data' && f.export_data && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
                <fieldset className="flex flex-wrap gap-x-3" disabled={!canEdit}>
                  <legend className="sr-only">Export formats</legend>
                  {FORMATS.map((b) => (
                    <label key={b.value} className="flex items-center gap-1 text-xs text-body">
                      <input type="checkbox" checked={f.export_formats.includes(b.value)} onChange={(e) => set('export_formats', toggle(f.export_formats, b.value, e.target.checked))} /> {b.label}
                    </label>
                  ))}
                </fieldset>
                <label className="flex items-center gap-1 text-xs text-body">
                  <input type="checkbox" disabled={!canEdit} checked={f.export_email} onChange={(e) => set('export_email', e.target.checked)} /> Allow sending by email
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save features
          </Button>
          <Button variant="secondary" loading={all.isPending} onClick={() => all.mutate()}>
            Apply to all tables
          </Button>
          <Button variant="ghost" disabled={JSON.stringify(f) === JSON.stringify(DEFAULT_FEATURES)} onClick={() => setF(DEFAULT_FEATURES)}>
            Switch everything on
          </Button>
        </div>
      )}
    </div>
  )
}
