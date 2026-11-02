import { Chip } from '@/design-system'
import type { StudioTable } from '@/api/types'
import { useTableFeatures } from './useTableFeatures'
import type { TableFeatures } from './features'

type Flag = 'sortable' | 'filterable' | 'inline_edit' | 'grouping' | 'export_data' | 'select_bulk' | 'statistics'
const SWITCHES: { flag: Flag; label: string; help: string }[] = [
  { flag: 'sortable', label: 'Sorting', help: 'column headers sort the list' },
  { flag: 'filterable', label: 'Filtering', help: 'filters on the list' },
  { flag: 'inline_edit', label: 'Edit in the list', help: 'double-click a cell to change it' },
  { flag: 'grouping', label: 'Group rows', help: 'group the list by a field' },
  { flag: 'export_data', label: 'Export data', help: 'download rows or share them by email' },
  { flag: 'select_bulk', label: 'Select rows', help: 'tick rows and act on many' },
  { flag: 'statistics', label: 'Numbers above the table', help: 'summary cards or a chart over the list' },
]

/** The table-wide switches above the Fields grid. They are the same stored flags as on the Features tab. */
export function TableWideBar({ table, canEdit, features, patch }: { table: StudioTable; canEdit: boolean; features: TableFeatures; patch: (c: Partial<TableFeatures>, onFail?: () => void) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Table-wide switches for ${table.label}`}>
      <span className="text-xs font-bold tracking-wide text-muted uppercase">Table-wide</span>
      {SWITCHES.map((s) => (
        <Chip
          key={s.flag}
          role="switch"
          checked={features[s.flag]}
          disabled={!canEdit}
          onChange={(on) => patch({ [s.flag]: on })}
          hint={`${features[s.flag] ? 'Turn off' : 'Turn on'} ${s.label} for every field of this table: ${s.help}.`}
        >
          {s.label} {features[s.flag] ? 'On' : 'Off'}
        </Chip>
      ))}
    </div>
  )
}

export { useTableFeatures }
