import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { studio } from '@/api/endpoints'
import type { FieldDef, StudioTable } from '@/api/types'
import { cn } from '@/design-system'
import type { TableFeatures } from './features'
import { useSaveField } from './useSaveField'

const NUMERIC = ['integer', 'decimal', 'money', 'months']
const CHARTABLE = ['select', 'text', 'boolean', 'date', ...NUMERIC]
const NO_COMPARE = ['long_text', 'tags', 'boolean']

const toggle = (list: string[], v: string, on: boolean) => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** The fields shown when the owner has not chosen: the table screen's own columns, else the first six. */
function automaticColumns(table: StudioTable, screenColumns: string[] | undefined): string[] {
  const have = new Set(table.fields.filter((f) => !f.hidden).map((f) => f.key))
  const fromScreen = (screenColumns ?? []).filter((k) => have.has(k))
  if (fromScreen.length) return fromScreen
  return table.fields.filter((f) => !f.hidden && f.type !== 'long_text').slice(0, 6).map((f) => f.key)
}

export interface Tick {
  id: string
  /** Short name used in the chip row. */
  short: string
  /** Full name in the dropdown. */
  label: string
  /** The small grey line beside it. */
  about: string
  on: boolean
  /** Why it cannot be changed, or why it has no effect for now. */
  why: string | null
  /** True when the reason is a table-wide switch that is off (the tick shows greyed). */
  tableOff: boolean
}

/** The eleven things a field can offer, in the fixed order the chip row and the dropdown use. */
export function ticksOf(table: StudioTable, f: TableFeatures, field: FieldDef, listless: boolean, ownColumns: string[] | undefined): Tick[] {
  const long = field.type === 'long_text'
  const isTitle = field.key === table.title_field
  const automatic = automaticColumns(table, ownColumns)
  const shown = f.default_columns ?? automatic
  const autoSummary = table.fields.filter((x) => !x.hidden && NUMERIC.includes(x.type)).slice(0, 3).map((x) => x.key)
  const summarised = f.stat_fields ?? autoSummary
  const off = (flag: keyof TableFeatures, label: string) => (f[flag] ? null : `Turn on ${label} in the bar above first.`)
  const noScreen = 'This table has no table screen, so there are no rows to show, group or tick.'
  const t = (id: string, short: string, label: string, about: string, on: boolean, own: string | null, master: string | null, extra: string | null = null): Tick => ({
    id, short, label, about, on, why: master ?? extra ?? own, tableOff: !!master,
  })
  return [
    t('shown', 'Shown', 'Shown in the list', 'a column of the default view', isTitle || shown.includes(field.key), isTitle ? 'The title always shows, because it opens the record.' : null, null, listless ? noScreen : null),
    t('sort', 'Sort', 'Sortable', 'header sort', !long && !f.unsortable.includes(field.key), long ? 'Long text cannot be sorted.' : null, off('sortable', 'Sorting')),
    t('filter', 'Filter', 'Filterable', 'filter menu', field.filterable !== false && !f.unfilterable.includes(field.key), null, off('filterable', 'Filtering')),
    t('edit', 'Edit', 'Editable in the list', 'double-click to edit', !f.uneditable.includes(field.key), null, off('inline_edit', 'Edit in the list')),
    t('group', 'Group', 'Groupable', 'group rows by it', !long && !f.ungroupable.includes(field.key), long ? 'Long text cannot be grouped.' : null, off('grouping', 'Group rows'), listless ? noScreen : null),
    t('export', 'Export', 'Exportable', 'a column in exports', !f.unexported.includes(field.key), null, off('export_data', 'Export data')),
    t('bulk', 'Bulk', 'Bulk edit', 'change on many rows', !long && !f.nobulk.includes(field.key), long ? 'Long text cannot be changed in bulk.' : null, off('select_bulk', 'Select rows'), listless ? noScreen : null),
    t('summary', 'Summary', 'In the summary numbers', 'a card above the table', summarised.includes(field.key), NUMERIC.includes(field.type) ? (f.stat_cards !== null ? 'Summary cards are chosen by hand.' : null) : 'Only number fields can be summarised.', off('statistics', 'Numbers above the table')),
    t('chart', 'Chart', 'Chart axis', 'offered in the chart builder', CHARTABLE.includes(field.type) && !f.nochart.includes(field.key), CHARTABLE.includes(field.type) ? null : 'This type of field cannot be a chart axis.', off('statistics', 'Numbers above the table')),
    t('unique', 'Unique', 'Unique', 'no two share a value', !!field.unique, NO_COMPARE.includes(field.type) ? 'Values of this type cannot be compared.' : null, null),
    t('search', 'Search', 'Searchable', 'keyword search', field.searchable !== false, null, null),
  ]
}

/** The Features cell: up to three chips for what is on, +N for the rest, and a caret that opens the full list. */
export function FeaturesCell({ table, field, f, patch, canEdit }: { table: StudioTable; field: FieldDef; f: TableFeatures; patch: (c: Partial<TableFeatures>, onFail?: () => void) => void; canEdit: boolean }) {
  const screens = useQuery({ queryKey: ['studio-screens'], queryFn: studio.screens, retry: false })
  const own = screens.data?.find((x) => x.table === table.key && x.pattern === 'searchable_table')
  const listless = !!screens.data && !own
  const ownColumns = (own?.config.columns as string[] | undefined) ?? undefined
  const save = useSaveField(table.key, field.key, 'feature')
  const [open, setOpen] = useState(false)
  const id = useId()
  // What a person just ticked shows at once; it is dropped as soon as the saved settings change (or the save fails).
  const snap = JSON.stringify([f, field.unique, field.searchable, field.filterable])
  const [opt, setOpt] = useState<{ snap: string; v: Record<string, boolean> }>({ snap: '', v: {} })
  const over = opt.snap === snap ? opt.v : {}
  const ticks = ticksOf(table, f, field, listless, ownColumns).map((x) => (x.id in over ? { ...x, on: over[x.id]! } : x))
  const active = ticks.filter((x) => x.on && !x.tableOff && !(x.id === 'shown' && listless))
  const first = active.slice(0, 3)
  const rest = active.length - first.length
  const automatic = automaticColumns(table, ownColumns)
  const autoSummary = table.fields.filter((x) => !x.hidden && NUMERIC.includes(x.type)).slice(0, 3).map((x) => x.key)

  const change = (tick: Tick, on: boolean) => {
    const k = field.key
    setOpt({ snap, v: { ...over, [tick.id]: on } })
    const fail = () => setOpt({ snap: '', v: {} })
    const patch2 = (c: Partial<TableFeatures>) => patch(c, fail)
    switch (tick.id) {
      case 'shown': {
        const now = f.default_columns ?? automatic
        const next = toggle(now, k, on)
        return patch2({ default_columns: sameSet(next, automatic) ? null : next })
      }
      case 'sort': return patch2({ unsortable: toggle(f.unsortable, k, !on) })
      case 'filter': return save.mutate({ filterable: on }, { onError: fail })
      case 'edit': return patch2({ uneditable: toggle(f.uneditable, k, !on) })
      case 'group': return patch2({ ungroupable: toggle(f.ungroupable, k, !on) })
      case 'export': return patch2({ unexported: toggle(f.unexported, k, !on) })
      case 'bulk': return patch2({ nobulk: toggle(f.nobulk, k, !on) })
      case 'summary': {
        const now = f.stat_fields ?? autoSummary
        const next = toggle(now, k, on)
        return patch2({ stat_fields: sameSet(next, autoSummary) ? null : next })
      }
      case 'chart': return patch2({ nochart: toggle(f.nochart, k, !on) })
      case 'unique': return save.mutate({ unique: on }, { onError: fail })
      case 'search': return save.mutate({ searchable: on }, { onError: fail })
    }
  }

  const summary = active.length ? active.map((x) => x.short).join(', ') : 'none'
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          data-testid={`features-of-${field.key}`}
          aria-label={`${first.map((x) => x.short).join(' ')}${rest > 0 ? ` +${rest}` : ''}${first.length ? '' : 'None'}. Features of ${field.label}`}
          aria-describedby={`${id}-all`}
          className="inline-flex max-w-full items-center gap-1 rounded-md px-1 py-0.5 hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {first.map((x) => (
            <span key={x.id} className="rounded-full bg-soft px-2 py-0.5 text-xs font-medium text-body">
              {x.short}{' '}
            </span>
          ))}
          {first.length === 0 && <span aria-hidden className="text-xs text-muted">None</span>}
          {rest > 0 && <span aria-hidden className="rounded-full border border-line px-1.5 py-0.5 text-xs font-semibold text-ink">+{rest}</span>}
          <ChevronDown className="size-3.5 text-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <span id={`${id}-all`} className="sr-only">On: {summary}.</span>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          aria-label={`Features of ${field.label}`}
          className="z-50 w-[26rem] max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-3 shadow-lg"
        >
          <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Features of this field</p>
          <ul className="flex flex-col">
            {ticks.map((x) => {
              const locked = !canEdit || !!x.why
              return (
                <li key={x.id}>
                  <label className={cn('flex items-center gap-2 rounded px-1 py-1 text-sm', locked ? 'cursor-not-allowed text-muted' : 'cursor-pointer text-ink hover:bg-soft')}>
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--color-accent,#1d4fd7)]"
                      checked={x.on}
                      disabled={locked}
                      aria-describedby={x.why ? `${id}-${x.id}-why` : undefined}
                      onChange={(e) => change(x, e.target.checked)}
                    />
                    <span className="flex-1">{x.label}</span>
                    <span className="text-xs text-muted">{x.about}</span>
                  </label>
                  {x.why && <p id={`${id}-${x.id}-why`} className="ml-7 text-xs text-muted">{x.why}</p>}
                </li>
              )
            })}
          </ul>
          <p className="mt-2 border-t border-line pt-2 text-xs text-muted">Greyed items are switched off for the whole table in the bar above.</p>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
