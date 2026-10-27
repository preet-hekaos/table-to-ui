import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Button, Chip, Input, Select, cn, useToast } from '@/design-system'
import { FieldGrid } from './FieldGrid'
import { DEFAULT_FEATURES, featuresOf, type StatCard, type TableFeatures } from './features'

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

/** Switch at the top right of a card. */
function Master({ title, on, canEdit, onChange, help }: { title: string; on: boolean; canEdit: boolean; onChange: (on: boolean) => void; help: string }) {
  return (
    <Chip role="switch" label={title} checked={on} disabled={!canEdit} onChange={onChange} hint={`${on ? 'Turn off' : 'Turn on'}: ${help}`}>
      {on ? 'On' : 'Off'}
    </Chip>
  )
}

const card = 'flex flex-col gap-4 rounded-xl border border-line bg-surface p-5'
const cardHead = 'flex items-start justify-between gap-4'
const smallLabel = 'text-xs font-semibold text-muted'

/** Per-table features: switches for the whole table, defaults, and the field options grid. */
export function FeaturesPanel({ table, canEdit }: { table: StudioTable; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const saved = featuresOf(table)
  const [f, setF] = useState<TableFeatures>(saved)
  // A list of keys is the same whatever order it was ticked in; switching something off and on again is no change.
  const same = (a: unknown, b: unknown) =>
    Array.isArray(a) && Array.isArray(b) && [...a, ...b].every((x) => typeof x === 'string')
      ? a.length === b.length && a.every((x) => b.includes(x))
      : JSON.stringify(a) === JSON.stringify(b)
  const changes = (Object.keys(f) as (keyof TableFeatures)[]).filter((k) => !same(f[k], saved[k])).length
  const dirty = changes > 0
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
    <div className="flex flex-col gap-6" data-testid="features-panel">
      <section className="flex flex-col gap-4" aria-labelledby="feat-table">
        <div>
          <h3 id="feat-table" className="text-base font-bold text-ink">For the whole table</h3>
          <p className="mt-1 text-sm text-muted">Turn off the features this table doesn&apos;t use. Changes stay in Draft until you publish.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className={card}>
            <div className={cardHead}>
              <div>
                <h4 className="text-[15px] font-semibold text-ink">Select rows, act on many</h4>
                <p className="mt-1 text-sm text-muted">Select rows on a page or every match, then act on them.</p>
              </div>
              <Master title="Select rows and act on many" on={f.select_bulk} canEdit={canEdit} onChange={(on) => set('select_bulk', on)} help="select rows on a page or every match, then act on them." />
            </div>
            {f.select_bulk && (
              <div className="mt-auto flex flex-col gap-2">
                <span className={smallLabel}>Actions</span>
                <fieldset className="flex flex-wrap gap-2" disabled={!canEdit}>
                  <legend className="sr-only">Bulk actions allowed</legend>
                  {BULK.map((b) => (
                    <Chip key={b.value} checked={f.bulk_actions.includes(b.value)} disabled={!canEdit} onChange={(on) => set('bulk_actions', toggle(f.bulk_actions, b.value, on))}>
                      {b.label}
                    </Chip>
                  ))}
                </fieldset>
                <label className="mt-1 flex flex-col gap-1.5 text-xs font-semibold text-muted">
                  Bulk actions include
                  <Select aria-label="Bulk actions include" disabled={!canEdit} value={f.bulk_scope} onChange={(e) => set('bulk_scope', e.target.value as TableFeatures['bulk_scope'])}>
                    <option value="view">Shown columns only</option>
                    <option value="all">Every field</option>
                  </Select>
                </label>
              </div>
            )}
          </div>

          <div className={card}>
            <div className={cardHead}>
              <div>
                <h4 className="text-[15px] font-semibold text-ink">Export data</h4>
                <p className="mt-1 text-sm text-muted">Download rows or share them as an email link.</p>
              </div>
              <Master title="Export data" on={f.export_data} canEdit={canEdit} onChange={(on) => set('export_data', on)} help="download rows or share them as an email link." />
            </div>
            {f.export_data && (
              <div className="mt-auto flex flex-col gap-2">
                <span className={smallLabel}>Formats</span>
                <fieldset className="flex flex-wrap gap-2" disabled={!canEdit}>
                  <legend className="sr-only">Export formats</legend>
                  {FORMATS.map((b) => (
                    <Chip key={b.value} checked={f.export_formats.includes(b.value)} disabled={!canEdit} onChange={(on) => set('export_formats', toggle(f.export_formats, b.value, on))}>
                      {b.label}
                    </Chip>
                  ))}
                  <Chip checked={f.export_email} disabled={!canEdit} onChange={(on) => set('export_email', on)} hint="Share an export as a link by email.">
                    Allow sending by email
                  </Chip>
                </fieldset>
              </div>
            )}
          </div>

          <div className="flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
            <div className={cn(cardHead, 'flex-1 p-5')}>
              <div>
                <h4 className="text-[15px] font-semibold text-ink">Import data</h4>
                <p className="mt-1 text-sm text-muted">CSV, JSON or Excel from the toolbar.</p>
              </div>
              <Master title="Import data" on={f.import_data} canEdit={canEdit} onChange={(on) => set('import_data', on)} help="CSV, JSON or Excel from the toolbar." />
            </div>
            <div className={cn(cardHead, 'flex-1 p-5')}>
              <div>
                <h4 className="text-[15px] font-semibold text-ink">Drag to reorder</h4>
                <p className="mt-1 text-sm text-muted">The order is shared across all users.</p>
              </div>
              <Master title="Drag to reorder" on={f.row_order} canEdit={canEdit} onChange={(on) => set('row_order', on)} help="rows can be moved up or down; the order is shared across all users." />
            </div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="feat-defaults">
        <h3 id="feat-defaults" className="text-base font-bold text-ink">Defaults</h3>
        <div className="grid gap-6 rounded-xl border border-line bg-surface p-5 md:grid-cols-3">
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink">
            Default order
            <Select
              aria-label="Default order"
              disabled={!canEdit || !f.sortable}
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
            <span className="text-xs font-normal text-muted">{f.sortable ? 'Row order before any column is sorted.' : 'Turn on Sorting in the field options first.'}</span>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-ink">
            Row density
            <Select aria-label="Row density" disabled={!canEdit} value={f.density} onChange={(e) => set('density', e.target.value as TableFeatures['density'])}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
            </Select>
            <span className="text-xs font-normal text-muted">Each user can still choose their own.</span>
          </label>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-ink">Numbers above the table</span>
            <div className="flex flex-wrap gap-2">
              <Chip checked={f.stat_scope === 'table'} disabled={!canEdit || !f.statistics} onChange={(on) => set('stat_scope', on ? 'table' : 'search')} hint="The numbers ignore the search and filters and always cover the whole table.">
                Whole table
              </Chip>
              <Chip checked={f.stat_cards !== null} disabled={!canEdit || !f.statistics} onChange={(on) => set('stat_cards', on ? [{ kind: 'count' }] : null)} hint="Pick up to six cards yourself instead of the automatic tiles.">
                Choose the summary cards myself
              </Chip>
            </div>
            <span className="text-xs text-muted">{f.statistics ? 'Whole table ignores search and filters. Fields to summarise are set in the field options below.' : 'Turn on Numbers above the table in the field options first.'}</span>
          </div>
        </div>
        {f.statistics && f.stat_cards !== null && (
          <div className="rounded-xl border border-line bg-surface p-5">
            <CardsEditor table={table} cards={f.stat_cards} canEdit={canEdit} onChange={(c) => set('stat_cards', c)} />
          </div>
        )}
      </section>

      <FieldGrid table={table} f={f} set={set} canEdit={canEdit} />

      {canEdit && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-5 py-3 shadow-[0_-4px_16px_rgba(20,26,38,0.06)]" role="region" aria-label="Save">
          <span className={cn('size-2 rounded-full', dirty ? 'bg-warn' : 'bg-line')} aria-hidden />
          <span className="text-sm font-medium text-ink">{dirty ? `${changes} unsaved ${changes === 1 ? 'change' : 'changes'}` : 'No unsaved changes'}</span>
          <span className="text-sm text-muted">Saved in Draft until you publish.</span>
          <span className="flex-1" />
          <Button variant="ghost" disabled={JSON.stringify(f) === JSON.stringify(DEFAULT_FEATURES)} onClick={() => setF(DEFAULT_FEATURES)}>
            Switch everything on
          </Button>
          <Button variant="secondary" loading={all.isPending} onClick={() => all.mutate()}>
            Apply to all tables
          </Button>
          <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}>
            Save features
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
