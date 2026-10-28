import { ApiError } from '@/api/client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Popover from '@radix-ui/react-popover'
import { SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Button, Chip, Select, cn, useToast } from '@/design-system'
import { FieldGrid } from './FieldGrid'
import { DEFAULT_FEATURES, featuresOf, type TableFeatures } from './features'

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
