import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Badge, Button, Input, Select, useToast } from '@/design-system'
import { FieldGrid } from './FieldGrid'
import { ACTIVE_FEATURES, DEFAULT_FEATURES, featuresOf, type StatCard, type TableFeatures } from './features'

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
            {it.key === 'statistics' && f.statistics && (
              <div className="flex flex-col gap-3 pl-7">
                <label className="flex items-center gap-2 text-xs text-body">
                  <input type="checkbox" className="size-4" disabled={!canEdit} checked={f.stat_scope === 'table'} onChange={(e) => set('stat_scope', e.target.checked ? 'table' : 'search')} />
                  Whole table: numbers ignore the search and filters
                </label>
                <label className="flex items-center gap-2 text-xs text-body">
                  <input
                    type="checkbox"
                    className="size-4"
                    disabled={!canEdit}
                    checked={f.stat_cards !== null}
                    onChange={(e) => set('stat_cards', e.target.checked ? [{ kind: 'count' }] : null)}
                  />
                  Choose the summary cards myself
                </label>
                {f.stat_cards !== null && <CardsEditor table={table} cards={f.stat_cards} canEdit={canEdit} onChange={(c) => set('stat_cards', c)} />}
                {f.stat_cards === null && (
                  <fieldset className="flex flex-col gap-1" disabled={!canEdit}>
                    <legend className="text-xs text-body">Number fields to summarise</legend>
                    <label className="flex items-center gap-1 text-xs text-body">
                      <input type="checkbox" checked={f.stat_fields === null} onChange={(e) => set('stat_fields', e.target.checked ? null : [])} /> Choose for me (the first three)
                    </label>
                    {f.stat_fields !== null &&
                      table.fields.filter((x) => ['integer', 'decimal', 'money', 'months'].includes(x.type)).map((x) => (
                        <label key={x.key} className="flex items-center gap-1 text-xs text-body">
                          <input type="checkbox" checked={f.stat_fields!.includes(x.key)} onChange={(e) => set('stat_fields', toggle(f.stat_fields!, x.key, e.target.checked))} /> {x.label}
                        </label>
                      ))}
                  </fieldset>
                )}
              </div>
            )}
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
      <FieldGrid table={table} f={f} set={set} canEdit={canEdit} />
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

const NUMBER_TYPES = ['integer', 'decimal', 'money', 'months']
const VALUE_TYPES = ['select', 'boolean', 'text']
const MEASURES: [StatCard['measure'], string][] = [['sum', 'Total'], ['avg', 'Average'], ['min', 'Lowest'], ['max', 'Highest']]

/** The summary strip, card by card: how many records, a number measured over a field, or how many hold a value. */
function CardsEditor({ table, cards, canEdit, onChange }: { table: StudioTable; cards: StatCard[]; canEdit: boolean; onChange: (c: StatCard[]) => void }) {
  const numbers = table.fields.filter((x) => NUMBER_TYPES.includes(x.type))
  const choices = table.fields.filter((x) => VALUE_TYPES.includes(x.type))
  const put = (i: number, c: StatCard) => onChange(cards.map((x, j) => (j === i ? c : x)))
  const kindChange = (i: number, kind: StatCard['kind']) => {
    if (kind === 'count') put(i, { kind })
    else if (kind === 'number') put(i, { kind, field: numbers[0]?.key ?? null, measure: 'sum' })
    else put(i, { kind, field: choices[0]?.key ?? null, value: choices[0]?.options?.[0] ?? '' })
  }
  return (
    <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
      <legend className="text-xs text-body">Cards, in order (up to six)</legend>
      {cards.length === 0 && <p className="text-xs text-muted">No cards: nothing is shown above the table.</p>}
      {cards.map((c, i) => {
        const valueField = choices.find((x) => x.key === c.field)
        return (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-canvas p-2" role="group" aria-label={`Card ${i + 1}`}>
            <label className="flex flex-col gap-0.5 text-xs text-body">
              Shows
              <Select aria-label={`Card ${i + 1} shows`} className="w-56" value={c.kind} onChange={(e) => kindChange(i, e.target.value as StatCard['kind'])}>
                <option value="count">How many records</option>
                <option value="number" disabled={numbers.length === 0}>A number field</option>
                <option value="value" disabled={choices.length === 0}>How many have a value</option>
              </Select>
            </label>
            {c.kind === 'number' && (
              <>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Measure
                  <Select aria-label={`Card ${i + 1} measure`} className="w-32" value={c.measure ?? 'sum'} onChange={(e) => put(i, { ...c, measure: e.target.value as StatCard['measure'] })}>
                    {MEASURES.map(([k, l]) => <option key={k} value={k!}>{l}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Field
                  <Select aria-label={`Card ${i + 1} field`} className="w-44" value={c.field ?? ''} onChange={(e) => put(i, { ...c, field: e.target.value })}>
                    {numbers.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </Select>
                </label>
              </>
            )}
            {c.kind === 'value' && (
              <>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Field
                  <Select aria-label={`Card ${i + 1} field`} className="w-44" value={c.field ?? ''} onChange={(e) => { const f2 = choices.find((x) => x.key === e.target.value); put(i, { ...c, field: e.target.value, value: f2?.options?.[0] ?? '' }) }}>
                    {choices.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Value
                  {valueField?.options?.length ? (
                    <Select aria-label={`Card ${i + 1} value`} className="w-40" value={c.value ?? ''} onChange={(e) => put(i, { ...c, value: e.target.value })}>
                      {valueField.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input aria-label={`Card ${i + 1} value`} className="w-40" value={c.value ?? ''} onChange={(e) => put(i, { ...c, value: e.target.value })} />
                  )}
                </label>
              </>
            )}
            <label className="flex flex-col gap-0.5 text-xs text-body">
              Name (optional)
              <Input aria-label={`Card ${i + 1} name`} className="w-40" maxLength={60} value={c.label ?? ''} onChange={(e) => put(i, { ...c, label: e.target.value || null })} />
            </label>
            <span className="ml-auto flex gap-1">
              <Button type="button" size="sm" variant="ghost" aria-label={`Move card ${i + 1} earlier`} disabled={i === 0} onClick={() => onChange(cards.map((x, j) => (j === i - 1 ? cards[i]! : j === i ? cards[i - 1]! : x)))}>Up</Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Remove card ${i + 1}`} onClick={() => onChange(cards.filter((_, j) => j !== i))}>Remove</Button>
            </span>
          </div>
        )
      })}
      <div>
        <Button type="button" size="sm" variant="secondary" disabled={cards.length >= 6} onClick={() => onChange([...cards, { kind: 'count' }])}>Add a card</Button>
      </div>
    </fieldset>
  )
}
