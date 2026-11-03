import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Button, Chip, Select, useToast } from '@/design-system'
import { StatCardsEditor } from './StatCardsEditor'
import type { TableFeatures } from './features'
import { useTableFeatures } from './useTableFeatures'

type Flag = 'sortable' | 'filterable' | 'inline_edit' | 'grouping' | 'export_data' | 'select_bulk' | 'import_data' | 'row_order' | 'statistics'
type Menu = 'export' | 'bulk' | 'numbers'
const SWITCHES: { flag: Flag; label: string; help: string; menu?: Menu; needsList?: boolean }[] = [
  { flag: 'sortable', label: 'Sorting', help: 'column headers sort the list' },
  { flag: 'filterable', label: 'Filtering', help: 'filters on the list' },
  { flag: 'inline_edit', label: 'Edit in the list', help: 'double-click a cell to change it' },
  { flag: 'grouping', label: 'Group rows', help: 'group the list by a field' },
  { flag: 'export_data', label: 'Export data', help: 'download rows or share them by email', menu: 'export' },
  { flag: 'select_bulk', label: 'Select rows', help: 'tick rows and act on many', menu: 'bulk', needsList: true },
  { flag: 'import_data', label: 'Import data', help: 'CSV, JSON or Excel from the toolbar' },
  { flag: 'row_order', label: 'Reorder rows', help: 'rows can be moved up or down; the order is shared across all users', needsList: true },
  { flag: 'statistics', label: 'Summary', help: 'summary cards or a chart over the list', menu: 'numbers' },
]
const BULK: { value: TableFeatures['bulk_actions'][number]; label: string }[] = [
  { value: 'export', label: 'Export' },
  { value: 'edit', label: 'Change a field value' },
  { value: 'delete', label: 'Delete (with Undo)' },
]
const FORMATS: { value: TableFeatures['export_formats'][number]; label: string }[] = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'xlsx', label: 'Excel' },
]
const toggle = <V extends string>(list: V[], v: V, on: boolean): V[] => (on ? [...new Set([...list, v])] : list.filter((x) => x !== v))
const smallLabel = 'text-xs font-semibold text-muted'

/** The ▾ beside a switch: that feature's extra choices in a small pop-over. Every change saves to the Draft at once. */
function MenuButton({ label, disabled, wide, children }: { label: string; disabled: boolean; wide?: boolean; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          disabled={disabled}
          title={disabled ? 'Turn the switch on first.' : label}
          className="-ml-1.5 inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-soft hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-label={label} className={`z-50 flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-lg ${wide ? 'w-[min(46rem,95vw)]' : 'w-72'}`}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * The table-wide switches above the Fields grid: one chip per feature, a ▾ for its extra choices, and Apply to all
 * tables. Each change saves to the Draft straight away and goes live on publish.
 */
export function TableWideBar({ table, canEdit, features, patch }: { table: StudioTable; canEdit: boolean; features: TableFeatures; patch: (c: Partial<TableFeatures>, onFail?: () => void) => void }) {
  // Rows to tick or drag exist only on a table screen; a table shown only as master-detail has none.
  const screens = useQuery({ queryKey: ['studio-screens'], queryFn: studio.screens, retry: false })
  const noList = screens.data && !screens.data.some((x) => x.table === table.key && x.pattern === 'searchable_table')
    ? 'This table has no table screen, only master-detail and other layouts, so there are no rows to tick or drag. Add a Searchable table screen to use this.'
    : false
  const menu = (m: Menu | undefined, on: boolean) => {
    if (m === 'export') {
      return (
        <MenuButton label="Export options" disabled={!on}>
          <span className={smallLabel}>Formats</span>
          <fieldset className="flex flex-wrap gap-2" disabled={!canEdit}>
            <legend className="sr-only">Export formats</legend>
            {FORMATS.map((b) => (
              <Chip key={b.value} checked={features.export_formats.includes(b.value)} disabled={!canEdit} onChange={(v) => patch({ export_formats: toggle(features.export_formats, b.value, v) })}>
                {b.label}
              </Chip>
            ))}
            <Chip checked={features.export_email} disabled={!canEdit} onChange={(v) => patch({ export_email: v })} hint="Share an export as a link by email.">
              Allow sending by email
            </Chip>
          </fieldset>
        </MenuButton>
      )
    }
    if (m === 'bulk') {
      return (
        <MenuButton label="Bulk action options" disabled={!on}>
          <span className={smallLabel}>Actions</span>
          <fieldset className="flex flex-wrap gap-2" disabled={!canEdit}>
            <legend className="sr-only">Bulk actions allowed</legend>
            {BULK.map((b) => (
              <Chip key={b.value} checked={features.bulk_actions.includes(b.value)} disabled={!canEdit} onChange={(v) => patch({ bulk_actions: toggle(features.bulk_actions, b.value, v) })}>
                {b.label}
              </Chip>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            Bulk actions include
            <Select aria-label="Bulk actions include" disabled={!canEdit} value={features.bulk_scope} onChange={(e) => patch({ bulk_scope: e.target.value as TableFeatures['bulk_scope'] })}>
              <option value="view">Shown columns only</option>
              <option value="all">Every field</option>
            </Select>
          </label>
        </MenuButton>
      )
    }
    if (m === 'numbers') {
      return (
        <MenuButton label="Summary options" disabled={!on} wide>
          <Chip
            label="Choose the summary cards myself"
            checked={features.stat_cards !== null}
            disabled={!canEdit}
            onChange={(v) => patch({ stat_cards: v ? [{ kind: 'count' }] : null })}
            hint="Pick up to six. Left off, the cards are automatic (how many, plus the average of each number field). Each person can still switch to a chart on the table screen."
          >
            Custom cards
          </Chip>
          {features.stat_cards !== null && <StatCardsEditor table={table} cards={features.stat_cards} canEdit={canEdit} onChange={(c) => patch({ stat_cards: c })} />}
        </MenuButton>
      )
    }
    return null
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2" role="group" aria-label={`Table-wide switches for ${table.label}`} data-testid="features-panel">
      <span className="text-xs font-bold tracking-wide text-muted uppercase">Table-wide</span>
      {SWITCHES.map((s) => {
        const blocked = s.needsList ? noList : false
        return (
          <span key={s.flag} className="inline-flex items-center gap-1">
            <Chip
              role="switch"
              checked={features[s.flag]}
              disabled={!canEdit || !!blocked}
              onChange={(on) => patch({ [s.flag]: on })}
              hint={blocked || `${features[s.flag] ? 'Turn off' : 'Turn on'} ${s.label} for every field of this table: ${s.help}.`}
            >
              {s.label} {features[s.flag] ? 'On' : 'Off'}
            </Chip>
            {menu(s.menu, features[s.flag])}
          </span>
        )
      })}
    </div>
  )
}

/** Copies this table's table-wide settings to every table. Sits beside the field search, not in the chip row. */
export function ApplyToAll({ features }: { features: TableFeatures }) {
  const qc = useQueryClient()
  const toast = useToast()
  const all = useMutation({
    mutationFn: () => studio.setAllFeatures(features),
    onSuccess: async (r) => {
      toast({ title: 'Applied to every table', description: `${r.tables.length} ${r.tables.length === 1 ? 'table' : 'tables'} changed in Draft.`, tone: 'ok' })
      await Promise.all(['studio-tables', 'studio-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: (e) => {
      const first = e instanceof ApiError ? e.errors[0] : undefined
      toast({ title: 'Could not apply', description: first ? first.message : (e as Error).message, tone: 'bad' })
    },
  })

  return (
    <Button size="sm" variant="secondary" loading={all.isPending} onClick={() => all.mutate()} title="Copy these table-wide settings to every table">
      Apply to all tables
    </Button>
  )
}

export { useTableFeatures }
