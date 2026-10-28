import { ApiError } from '@/api/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Popover from '@radix-ui/react-popover'
import { SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Button, Chip, Input, Select, cn, useToast } from '@/design-system'
import { FieldGrid } from './FieldGrid'
import { DEFAULT_CHART, DEFAULT_FEATURES, featuresOf, type ChartConfig, type ChartType, type StatCard, type TableFeatures } from './features'

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

/** A feature switch in the bar: it is on when it carries the tick. `title` is its accessible name. */
function Master({ title, label, on, canEdit, onChange, help }: { title: string; label: string; on: boolean; canEdit: boolean; onChange: (on: boolean) => void; help: string }) {
  return (
    <Chip role="switch" label={title} checked={on} disabled={!canEdit} onChange={onChange} hint={`${on ? 'Turn off' : 'Turn on'}: ${help}`}>
      {label}
    </Chip>
  )
}

/** The extra choices of a feature, in a small pop-over so the bar stays one line. */
function Options({ label, disabled, children }: { label: string; disabled: boolean; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          title={disabled ? 'Turn the feature on first.' : label}
          className="-ml-1.5 inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <SlidersHorizontal className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-label={label} className="z-50 flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-lg">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const rowLabel = 'mr-1 w-40 shrink-0 text-xs font-bold tracking-wide text-muted uppercase'
const inlineLabel = 'flex items-center gap-2 text-[13px] font-semibold text-ink'
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
  const failed = (e: unknown) => {
    const first = e instanceof ApiError ? e.errors[0] : undefined
    const why = first ? `${first.field ? `${first.field}: ` : ''}${first.message}` : (e as Error).message
    const stale = e instanceof ApiError && e.status === 422 ? ' If you just updated the code, restart the API and try again.' : ''
    toast({ title: 'Could not save features', description: `${why}.${stale}`.replace(/\.\./g, '.'), tone: 'bad' })
  }
  const save = useMutation({
    mutationFn: () => studio.setFeatures(table.key, f),
    onSuccess: () => done(`Saved features for ${table.label}`, 'Saved in Draft. Publish to make it live.'),
    onError: failed,
  })
  const all = useMutation({
    mutationFn: () => studio.setAllFeatures(f),
    onSuccess: (r) => done('Applied to every table', `${r.tables.length} ${r.tables.length === 1 ? 'table' : 'tables'} changed in Draft.`),
    onError: failed,
  })

  const off = !canEdit || !f.statistics
  return (
    <div className="flex flex-col gap-5" data-testid="features-panel">
      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <section className="flex flex-wrap items-center gap-2 px-4 py-3" aria-labelledby="feat-table">
          <h3 id="feat-table" className={rowLabel}>For the whole table</h3>
          <Master title="Select rows and act on many" label="Select and bulk" on={f.select_bulk} canEdit={canEdit} onChange={(on) => set('select_bulk', on)} help="select rows on a page or every match, then act on them." />
          <Options label="Bulk action options" disabled={!f.select_bulk}>
            <span className={smallLabel}>Actions</span>
            <fieldset className="flex flex-wrap gap-2" disabled={!canEdit}>
              <legend className="sr-only">Bulk actions allowed</legend>
              {BULK.map((b) => (
                <Chip key={b.value} checked={f.bulk_actions.includes(b.value)} disabled={!canEdit} onChange={(on) => set('bulk_actions', toggle(f.bulk_actions, b.value, on))}>
                  {b.label}
                </Chip>
              ))}
            </fieldset>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
              Bulk actions include
              <Select aria-label="Bulk actions include" disabled={!canEdit} value={f.bulk_scope} onChange={(e) => set('bulk_scope', e.target.value as TableFeatures['bulk_scope'])}>
                <option value="view">Shown columns only</option>
                <option value="all">Every field</option>
              </Select>
            </label>
          </Options>
          <Master title="Export data" label="Export" on={f.export_data} canEdit={canEdit} onChange={(on) => set('export_data', on)} help="download rows or share them as an email link." />
          <Options label="Export options" disabled={!f.export_data}>
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
          </Options>
          <Master title="Import data" label="Import" on={f.import_data} canEdit={canEdit} onChange={(on) => set('import_data', on)} help="CSV, JSON or Excel from the toolbar." />
          <Master title="Drag to reorder" label="Reorder" on={f.row_order} canEdit={canEdit} onChange={(on) => set('row_order', on)} help="rows can be moved up or down; the order is shared across all users." />
        </section>

        <section className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3" aria-labelledby="feat-defaults">
          <h3 id="feat-defaults" className={rowLabel}>Defaults</h3>
          <label className={inlineLabel} title={f.sortable ? 'Row order before any column is sorted.' : 'Turn on Sorting in the field options first.'}>
            Order
            <Select
              aria-label="Default order"
              className="w-56 !h-8 !text-[13px]"
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
          </label>
          <label className={inlineLabel} title="Each user can still choose their own.">
            Density
            <Select aria-label="Row density" className="w-36 !h-8 !text-[13px]" disabled={!canEdit} value={f.density} onChange={(e) => set('density', e.target.value as TableFeatures['density'])}>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
            </Select>
          </label>
          <label className={inlineLabel} title={f.statistics ? 'What sits above the table.' : 'Turn on Numbers above the table in the field options first.'}>
            Numbers above
            <Select aria-label="Show numbers as" className="w-40 !h-8 !text-[13px]" disabled={off} value={f.stat_view} onChange={(e) => set('stat_view', e.target.value as TableFeatures['stat_view'])}>
              <option value="cards">Summary cards</option>
              <option value="chart">A chart</option>
            </Select>
          </label>
          <Chip checked={f.stat_scope === 'table'} disabled={off} onChange={(on) => set('stat_scope', on ? 'table' : 'search')} hint="The numbers ignore the search and filters and always cover the whole table.">
            Whole table
          </Chip>
          {f.stat_view === 'cards' && (
            <Chip checked={f.stat_cards !== null} disabled={off} onChange={(on) => set('stat_cards', on ? [{ kind: 'count' }] : null)} hint="Pick up to six cards yourself instead of the automatic tiles.">
              Choose the summary cards myself
            </Chip>
          )}
          {!f.statistics && <span className="text-xs text-muted">Turn on Numbers above the table in the field options first.</span>}
        </section>

        {f.statistics && f.stat_view === 'chart' && (
          <div className="border-t border-line px-4 py-3">
            <ChartEditor table={table} f={f} canEdit={canEdit} onChange={(c) => set('chart', c)} />
          </div>
        )}
        {f.statistics && f.stat_view === 'cards' && f.stat_cards !== null && (
          <div className="border-t border-line px-4 py-3">
            <CardsEditor table={table} cards={f.stat_cards} canEdit={canEdit} onChange={(c) => set('stat_cards', c)} />
          </div>
        )}
      </div>

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

const CHART_TYPES: [ChartType, string][] = [['combo', 'Bars and line'], ['bar', 'Bars'], ['hbar', 'Horizontal bars'], ['line', 'Line'], ['area', 'Area'], ['donut', 'Share (donut)']]
const GROUP_TYPES = ['select', 'text', 'boolean', 'date']

/** The chart a table starts with: its type, what it groups by and what it measures. Each user can still change these on the screen. */
function ChartEditor({ table, f, canEdit, onChange }: { table: StudioTable; f: TableFeatures; canEdit: boolean; onChange: (c: ChartConfig) => void }) {
  const c = f.chart ?? DEFAULT_CHART
  const free = (x: { key: string }) => !f.nochart.includes(x.key)
  const groups = table.fields.filter((x) => GROUP_TYPES.includes(x.type) && !x.hidden && free(x))
  const numbers = table.fields.filter((x) => NUMBER_TYPES.includes(x.type) && !x.hidden && free(x))
  const x = groups.find((g) => g.key === c.x) ?? groups[0]
  const options = [
    { key: 'count', label: `Count of ${table.plural_label.toLowerCase()}` },
    ...numbers.flatMap((n) => [{ key: `sum:${n.key}`, label: `Total ${n.label.toLowerCase()}` }, { key: `avg:${n.key}`, label: `Average ${n.label.toLowerCase()}` }]),
  ]
  const mk = (m?: ChartConfig['measures'][number]) => (!m ? '' : m.agg === 'count' ? 'count' : `${m.agg}:${m.field}`)
  const parse = (k: string): ChartConfig['measures'][number] => { const [agg, field] = k.split(':'); return agg === 'count' || !field ? { agg: 'count' } : { agg: agg as 'sum' | 'avg', field } }
  const setM = (i: number, k: string) => {
    const next = [...c.measures]
    if (k === '') next.splice(i, 1)
    else next[i] = parse(k)
    onChange({ ...c, measures: next.slice(0, 2) })
  }
  return (
    <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2" disabled={!canEdit} data-testid="chart-editor" title="Which fields can be grouped or measured is set in the Chart column of the field options below.">
      <legend className="sr-only">The chart</legend>
      <span className={rowLabel} aria-hidden>The chart</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chart type">
        {CHART_TYPES.map(([k, l]) => (
          <Chip key={k} checked={c.type === k} disabled={!canEdit} onChange={() => onChange({ ...c, type: k })} hint={`Start with ${l.toLowerCase()}.`}>
            {l}
          </Chip>
        ))}
      </div>
      <div className="contents">
        <label className={inlineLabel}>
          Group by
          <Select aria-label="Chart group by" className="w-36 !h-8 !text-[13px]" value={x?.key ?? ''} onChange={(e) => onChange({ ...c, x: e.target.value })}>
            {groups.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
          </Select>
        </label>
        {x?.type === 'date' ? (
          <label className={inlineLabel}>
            Period
            <Select aria-label="Chart period" className="w-28 !h-8 !text-[13px]" value={c.bucket} onChange={(e) => onChange({ ...c, bucket: e.target.value as ChartConfig['bucket'] })}>
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </Select>
          </label>
        ) : (
          <label className={inlineLabel}>
            Groups shown
            <Select aria-label="Chart groups shown" className="w-20 !h-8 !text-[13px]" value={c.top} onChange={(e) => onChange({ ...c, top: Number(e.target.value) })}>
              {[5, 8, 10, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </label>
        )}
        <label className={inlineLabel}>
          Measure
          <Select aria-label="Chart measure" className="w-48 !h-8 !text-[13px]" value={mk(c.measures[0])} onChange={(e) => setM(0, e.target.value)}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
        </label>
        <label className={inlineLabel}>
          Line
          <Select aria-label="Chart second measure" className="w-40 !h-8 !text-[13px]" value={mk(c.measures[1])} onChange={(e) => setM(1, e.target.value)}>
            <option value="">None</option>
            {options.filter((o) => o.key !== mk(c.measures[0])).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </Select>
        </label>
      </div>
    </fieldset>
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
