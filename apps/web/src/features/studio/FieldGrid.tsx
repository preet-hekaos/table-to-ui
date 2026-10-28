import { useQuery } from '@tanstack/react-query'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Chip, ScrollArea, cn } from '@/design-system'
import type { TableFeatures } from './features'

const NUMERIC = ['integer', 'decimal', 'money', 'months']

/** The fields shown when the owner has not chosen: the table screen's own columns, else the first six. */
function automaticColumns(table: StudioTable, screenColumns: string[] | undefined): string[] {
  const have = new Set(table.fields.filter((f) => !f.hidden).map((f) => f.key))
  const fromScreen = (screenColumns ?? []).filter((k) => have.has(k))
  if (fromScreen.length) return fromScreen
  return table.fields.filter((f) => !f.hidden && f.type !== 'long_text').slice(0, 6).map((f) => f.key)
}

const toggle = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

type Master = 'sortable' | 'filterable' | 'inline_edit' | 'grouping' | 'statistics'

interface Column {
  short: string
  /** The table-wide switch in the heading, when the option has one of its own. */
  master?: { flag: Master; label: string }
  /** Another switch on this tab that this option follows. */
  follows?: { flag: 'export_data' | 'select_bulk'; label: string }
}

const COLUMNS: Column[] = [
  { short: 'Shown' },
  { short: 'Sort', master: { flag: 'sortable', label: 'Sorting' } },
  { short: 'Filter', master: { flag: 'filterable', label: 'Filtering' } },
  { short: 'Edit', master: { flag: 'inline_edit', label: 'Edit in the list' } },
  { short: 'Group', master: { flag: 'grouping', label: 'Group rows' } },
  { short: 'Export', follows: { flag: 'export_data', label: 'Export data' } },
  { short: 'Bulk', follows: { flag: 'select_bulk', label: 'Select rows' } },
  { short: 'Summary', master: { flag: 'statistics', label: 'Numbers above the table' } },
]

/**
 * One row per field, one column per option. The heading of a column holds the on/off for the whole table;
 * the chips below say which fields it covers. Everything starts on.
 */
export function FieldGrid({
  table,
  f,
  set,
  canEdit,
}: {
  table: StudioTable
  f: TableFeatures
  set: <K extends keyof TableFeatures>(k: K, v: TableFeatures[K]) => void
  canEdit: boolean
}) {
  const screens = useQuery({ queryKey: ['studio-screens'], queryFn: studio.screens, retry: false })
  const own = screens.data?.find((x) => x.table === table.key && x.pattern === 'searchable_table')
  const automatic = automaticColumns(table, (own?.config.columns as string[] | undefined) ?? undefined)
  const shown = f.default_columns ?? automatic
  const fields = table.fields.filter((x) => !x.hidden)
  const cardsChosen = f.stat_cards !== null
  const autoSummary = fields.filter((x) => NUMERIC.includes(x.type)).slice(0, 3).map((x) => x.key)
  const summarised = f.stat_fields ?? autoSummary

  /** Is this option usable for the table at all, and if not, which switch to turn on first. */
  const blocked = (c: Column): string | null => {
    if (c.master && !f[c.master.flag]) return `Turn on ${c.master.label} first.`
    if (c.follows && !f[c.follows.flag]) return `Turn on ${c.follows.label} first.`
    return null
  }

  const chip = (c: Column, label: string, hint: string, checked: boolean, onChange: (on: boolean) => void, own?: { disabled: boolean; why: string }) => {
    const why = blocked(c) ?? (own?.disabled ? own.why : null)
    return (
      <Chip key={c.short} label={label} hint={why ?? hint} checked={checked} onChange={onChange} disabled={!canEdit || !!why}>
        {c.short}
      </Chip>
    )
  }
  const col = (short: string) => COLUMNS.find((c) => c.short === short)!

  const rowGrid = 'grid grid-cols-[13rem_repeat(8,minmax(0,1fr))] items-center px-5'

  return (
    <section className="flex flex-col gap-4" aria-labelledby="field-grid-title" data-testid="field-grid">
      <div>
        <h3 id="field-grid-title" className="text-base font-bold text-ink">Field options</h3>
        <p className="mt-1 text-sm text-muted">
          Each heading turns that option on or off for the whole table. Hover a chip for details. The title always shows, because it opens the record.
        </p>
      </div>
      <ScrollArea axis="x" className="rounded-xl border border-line bg-surface">
        <div className="min-w-[60rem]" role="table" aria-label="Field options">
          <div role="row" className={cn(rowGrid, 'h-[4.5rem] border-b border-line bg-soft')}>
            <span role="columnheader" className="text-xs font-semibold text-ink">Field</span>
            {COLUMNS.map((c) => (
              <span key={c.short} role="columnheader" className="flex flex-col items-center gap-1.5">
                <span className="text-xs font-semibold text-ink">{c.short}</span>
                {c.master ? (
                  <Chip
                    role="switch"
                    label={c.master.label}
                    checked={f[c.master.flag]}
                    disabled={!canEdit}
                    onChange={(on) => set(c.master!.flag, on as never)}
                    hint={`${f[c.master.flag] ? 'Turn off' : 'Turn on'} ${c.master.label} for this table.`}
                    className="h-6 px-2.5 text-[11px]"
                  >
                    {f[c.master.flag] ? 'On' : 'Off'}
                  </Chip>
                ) : (
                  <span className="text-center text-[11px] leading-tight text-body">{c.follows ? `Follows ${c.follows.label}` : 'Default columns'}</span>
                )}
              </span>
            ))}
          </div>
          {fields.map((x) => {
            const isTitle = x.key === table.title_field
            const long = x.type === 'long_text'
            const numeric = NUMERIC.includes(x.type)
            return (
              <div key={x.key} role="row" className={cn(rowGrid, 'h-[3.25rem] border-b border-line/60 last:border-b-0')} aria-label={x.label}>
                <span role="rowheader" className="text-sm font-medium text-ink">{x.label}</span>
                <span role="cell" className="flex justify-center">
                  {chip(col('Shown'), `Show ${x.label} by default`, 'Show this column in the list from the start. Each user can still add or hide it for themselves.', isTitle || shown.includes(x.key), (on) => { const next = toggle(shown, x.key, on); set('default_columns', sameSet(next, automatic) ? null : next) }, { disabled: isTitle, why: 'The title always shows, because it opens the record.' })}
                </span>
                <span role="cell" className="flex justify-center">
                  {chip(col('Sort'), `Sort by ${x.label}`, `Sorting the list by ${x.label}.`, !long && !f.unsortable.includes(x.key), (on) => set('unsortable', toggle(f.unsortable, x.key, !on)), { disabled: long, why: 'Long text cannot be sorted.' })}
                </span>
                <span role="cell" className="flex justify-center">
                  {chip(col('Filter'), `Filter by ${x.label}`, `Filtering the list by ${x.label}.`, !f.unfilterable.includes(x.key), (on) => set('unfilterable', toggle(f.unfilterable, x.key, !on)))}
                </span>
                <span role="cell" className="flex justify-center">
                  {chip(col('Edit'), `Edit ${x.label} in the list`, `Editing ${x.label} by double-clicking its cell.`, !f.uneditable.includes(x.key), (on) => set('uneditable', toggle(f.uneditable, x.key, !on)))}
                </span>
                <span role="cell" className="flex justify-center">
                  {chip(col('Group'), `Group by ${x.label}`, `Grouping the list by ${x.label}.`, !long && !f.ungroupable.includes(x.key), (on) => set('ungroupable', toggle(f.ungroupable, x.key, !on)), { disabled: long, why: 'Long text cannot be grouped.' })}
                </span>
                <span role="cell" className="flex justify-center">
                  {chip(col('Export'), `Export ${x.label}`, `Including ${x.label} in exports.`, !f.unexported.includes(x.key), (on) => set('unexported', toggle(f.unexported, x.key, !on)))}
                </span>
                <span role="cell" className="flex justify-center">
                  {chip(col('Bulk'), `Change ${x.label} for many rows`, `Changing ${x.label} on many selected rows at once.`, !long && !f.nobulk.includes(x.key), (on) => set('nobulk', toggle(f.nobulk, x.key, !on)), { disabled: long, why: 'Long text cannot be changed in bulk.' })}
                </span>
                <span role="cell" className="flex justify-center">
                  {numeric ? (
                    chip(col('Summary'), `Summarise ${x.label}`, `Including ${x.label} in the numbers above the table.`, summarised.includes(x.key), (on) => { const next = toggle(summarised, x.key, on); set('stat_fields', sameSet(next, autoSummary) ? null : next) }, { disabled: cardsChosen, why: 'Summary cards are chosen by hand.' })
                  ) : (
                    <span className="text-sm text-muted" aria-label="Not available">–</span>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      </ScrollArea>
      {f.default_columns !== null && (
        <button type="button" className="self-start text-xs font-medium text-accent underline" disabled={!canEdit} onClick={() => set('default_columns', null)}>
          Go back to the automatic columns
        </button>
      )}
    </section>
  )
}
