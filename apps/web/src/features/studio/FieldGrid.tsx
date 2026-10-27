import { useQuery } from '@tanstack/react-query'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Select } from '@/design-system'
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

/**
 * One grid for what a person can do with each field: show it, sort, filter, edit in the list,
 * group, export, change for many rows. Ticked means allowed; everything starts ticked.
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
  const shown = f.default_columns ?? automaticColumns(table, (own?.config.columns as string[] | undefined) ?? undefined)
  const fields = table.fields.filter((x) => !x.hidden)
  const cardsChosen = f.stat_cards !== null
  const autoSummary = fields.filter((x) => NUMERIC.includes(x.type)).slice(0, 3).map((x) => x.key)
  const summarised = f.stat_fields ?? autoSummary

  const cell = (label: string, checked: boolean, onChange: (on: boolean) => void, disabled = false, title?: string) => (
    <td className="px-2 py-1 text-center">
      <input
        type="checkbox"
        className="size-5"
        aria-label={label}
        title={title}
        disabled={!canEdit || disabled}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </td>
  )

  return (
    <section className="flex flex-col gap-2" aria-labelledby="field-grid-title" data-testid="field-grid">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="field-grid-title" className="text-sm font-semibold text-ink">Fields</h3>
          <p className="text-xs text-muted">Tick what people may do with each field. The title always shows, because it opens the record.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-body">
          Row density
          <Select aria-label="Row density" className="w-40" disabled={!canEdit} value={f.density} onChange={(e) => set('density', e.target.value as TableFeatures['density'])}>
            <option value="compact">Compact</option>
            <option value="comfortable">Comfortable</option>
          </Select>
        </label>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-xs text-body" aria-label="What people can do with each field">
          <thead className="bg-soft text-ink">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-semibold">Field</th>
              <th scope="col" className="px-2 py-2 font-semibold">Shown</th>
              <th scope="col" className="px-2 py-2 font-semibold">Sort</th>
              <th scope="col" className="px-2 py-2 font-semibold">Filter</th>
              <th scope="col" className="px-2 py-2 font-semibold">Edit in list</th>
              <th scope="col" className="px-2 py-2 font-semibold">Group</th>
              <th scope="col" className="px-2 py-2 font-semibold">Export</th>
              <th scope="col" className="px-2 py-2 font-semibold">Bulk edit</th>
              <th scope="col" className="px-2 py-2 font-semibold">In summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {fields.map((x) => {
              const isTitle = x.key === table.title_field
              const long = x.type === 'long_text'
              const numeric = NUMERIC.includes(x.type)
              return (
                <tr key={x.key}>
                  <th scope="row" className="px-3 py-1 text-left font-medium text-ink">{x.label}</th>
                  {cell(`Show ${x.label} by default`, isTitle || shown.includes(x.key), (on) => set('default_columns', toggle(shown, x.key, on)), isTitle, isTitle ? 'The title always shows' : undefined)}
                  {cell(`Sort by ${x.label}`, !long && !f.unsortable.includes(x.key), (on) => set('unsortable', toggle(f.unsortable, x.key, !on)), long)}
                  {cell(`Filter by ${x.label}`, !f.unfilterable.includes(x.key), (on) => set('unfilterable', toggle(f.unfilterable, x.key, !on)))}
                  {cell(`Edit ${x.label} in the list`, !f.uneditable.includes(x.key), (on) => set('uneditable', toggle(f.uneditable, x.key, !on)), !f.inline_edit)}
                  {cell(`Group by ${x.label}`, !long && !f.ungroupable.includes(x.key), (on) => set('ungroupable', toggle(f.ungroupable, x.key, !on)), long || !f.grouping)}
                  {cell(`Export ${x.label}`, !f.unexported.includes(x.key), (on) => set('unexported', toggle(f.unexported, x.key, !on)), !f.export_data)}
                  {cell(`Change ${x.label} for many rows`, !f.nobulk.includes(x.key), (on) => set('nobulk', toggle(f.nobulk, x.key, !on)), !f.select_bulk || long)}
                  {numeric ? (
                    cell(
                      `Summarise ${x.label}`,
                      summarised.includes(x.key),
                      (on) => set('stat_fields', toggle(summarised, x.key, on)),
                      !f.statistics || cardsChosen,
                      cardsChosen ? 'Summary cards are chosen by hand' : f.stat_fields === null ? 'Automatic: the first three number fields' : undefined,
                    )
                  ) : (
                    <td className="px-2 py-1 text-center text-muted" aria-hidden>–</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {f.default_columns !== null && (
        <button type="button" className="self-start text-xs font-medium text-accent underline" disabled={!canEdit} onClick={() => set('default_columns', null)}>
          Go back to the automatic columns
        </button>
      )}
    </section>
  )
}
