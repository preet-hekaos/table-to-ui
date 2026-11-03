import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Download, Pencil, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { app, archive, type BulkBody, type BulkResult, type ListQuery } from '@/api/endpoints'
import type { FieldDef, TableDef } from '@/api/types'
import { Button, Dialog, DialogContent, Field, Input, Select, useToast } from '@/design-system'
import type { TableFeatures } from '@/features/studio/features'
import { can as hasPermission, useMe } from '@/features/auth/useMe'

export const MAX_BULK = 10_000
const TYPES_NOT_EDITED_IN_BULK = new Set(['long_text', 'reference'])

/** Fields a person may change on many rows: shown, not unique, and a kind with a single plain input. */
export const bulkFields = (table: TableDef): FieldDef[] =>
  table.fields.filter((f) => !f.hidden && !f.unique && !TYPES_NOT_EDITED_IN_BULK.has(f.type) && !(table.features?.nobulk ?? []).includes(f.key))

function valueFor(f: FieldDef, raw: string): unknown {
  if (raw === '') return null
  if (f.type === 'integer' || f.type === 'decimal') return Number(raw)
  if (f.type === 'boolean') return raw === 'true'
  if (f.type === 'tags') return raw.split(',').map((t) => t.trim()).filter(Boolean)
  return raw
}

function ValueInput({ f, value, onChange, id }: { f: FieldDef; value: string; onChange: (v: string) => void; id?: string }) {
  if (f.type === 'select' || f.type === 'boolean')
    return (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {(f.type === 'boolean' ? ['true', 'false'] : f.options).map((o) => (
          <option key={o} value={o}>{f.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : o}</option>
        ))}
      </Select>
    )
  const type = f.type === 'integer' || f.type === 'decimal' || f.type === 'money' ? 'number' : f.type === 'date' ? 'date' : 'text'
  return <Input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} />
}

/** What is picked, and what can be done with it: export, change a value, delete (each with a way back). */
export function BulkBar({
  table,
  feat,
  picked,
  query,
  allShown,
  canUpdate,
  canDelete,
  onClear,
  onExport,
}: {
  table: TableDef
  feat: TableFeatures
  picked: Set<string>
  query: ListQuery
  /** Every row that is loaded is picked, so offering "all matching" makes sense. */
  allShown: boolean
  canUpdate: boolean
  canDelete: boolean
  onClear: () => void
  onExport: (ids: Set<string> | null) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const me = useMe()
  const canArchive = !!me.data && hasPermission(me.data.permissions, 'workspace.manage')
  const [everyMatch, setEveryMatch] = useState(false)
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null)
  const [field, setField] = useState('')
  const [raw, setRaw] = useState('')
  const [error, setError] = useState('')
  const count = useQuery({ queryKey: ['count', table.key, query], queryFn: () => app.count(table.key, query), enabled: allShown })
  const total = count.data ?? 0
  const n = everyMatch ? total : picked.size
  const can = (a: 'export' | 'edit' | 'delete') => feat.bulk_actions.includes(a)
  const fields = bulkFields(table)
  const chosen = fields.find((f) => f.key === field)

  const body = (b: Omit<BulkBody, 'ids' | 'matching'>): BulkBody =>
    everyMatch
      ? { ...b, matching: { q: query.q || undefined, filters: query.filters ?? {}, ranges: query.ranges ?? {}, contains: query.contains ?? {}, anyof: query.anyof ?? {}, expected_count: total } }
      : { ...b, ids: [...picked] }
  const refresh = async () => {
    await Promise.all(['records', 'count', 'stats', 'facets', 'measures'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  }
  const undo = useMutation({
    mutationFn: (u: NonNullable<BulkResult['undo']>) => app.bulk(table.key, { action: 'undo', undo: u }),
    onSuccess: async (r) => {
      toast({ title: `Undone: ${r.applied.toLocaleString('en-IN')} restored`, tone: 'ok' })
      await refresh()
    },
    onError: (e) => toast({ title: 'Could not undo', description: e instanceof ApiError ? e.message : undefined, tone: 'bad' }),
  })
  const archiveRecords = useMutation({
    mutationFn: (b: BulkBody) => archive.addRecords(table.key, b),
    onSuccess: async (r) => {
      const failed = r.failed.length
      toast({
        title: `${r.archived.toLocaleString('en-IN')} archived${failed ? `, ${failed} could not be` : ''}`,
        description: failed ? r.failed[0]?.message : 'Restore them in Settings › Archive.',
        tone: failed ? 'bad' : 'ok',
      })
      setDialog(null)
      setError('')
      onClear()
      await refresh()
      await qc.invalidateQueries({ queryKey: ['archive'] })
    },
    onError: (e) => setError(e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : 'Nothing was archived.'),
  })
  const run = useMutation({
    mutationFn: (b: BulkBody) => app.bulk(table.key, b),
    onSuccess: async (r, b) => {
      const what = b.action === 'delete' ? 'deleted' : 'changed'
      const failed = r.failed.length
      toast({
        title: `${r.applied.toLocaleString('en-IN')} ${what}${failed ? `, ${failed} could not be` : ''}`,
        description: failed ? r.failed[0]?.message : undefined,
        tone: failed ? 'bad' : 'ok',
        action: r.undo ? { label: 'Undo', onClick: () => undo.mutate(r.undo!) } : undefined,
      })
      setDialog(null)
      setError('')
      onClear()
      await refresh()
    },
    onError: (e) => setError(e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : 'Nothing was changed.'),
  })

  if (picked.size === 0) return null
  return (
    <div role="region" aria-label="Selected rows" className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-accent bg-accent-soft px-3 py-2" data-testid="bulk-bar">
      <span className="text-sm font-semibold text-accent-ink" aria-live="polite">{n.toLocaleString('en-IN')} selected</span>
      {allShown && !everyMatch && total > picked.size && total <= MAX_BULK && (
        <Button variant="ghost" onClick={() => setEveryMatch(true)}>Select all {total.toLocaleString('en-IN')} matching</Button>
      )}
      {allShown && total > MAX_BULK && <span className="text-xs text-muted">More than {MAX_BULK.toLocaleString('en-IN')} match. Narrow the search to act on all of them.</span>}
      <span className="ml-auto flex flex-wrap gap-2">
        {can('export') && (
          <Button variant="secondary" onClick={() => onExport(everyMatch ? null : picked)}>
            <Download className="size-4" aria-hidden /> Export
          </Button>
        )}
        {can('edit') && canUpdate && fields.length > 0 && (
          <Button variant="secondary" onClick={() => { setField(''); setRaw(''); setError(''); setDialog('edit') }}>
            <Pencil className="size-4" aria-hidden /> Change a value
          </Button>
        )}
        {can('delete') && canDelete && (
          <Button variant="secondary" onClick={() => { setError(''); setDialog('delete') }}>
            {canArchive ? <Archive className="size-4" aria-hidden /> : <Trash2 className="size-4" aria-hidden />} {canArchive ? 'Archive' : 'Delete'}
          </Button>
        )}
        <Button variant="ghost" onClick={() => { setEveryMatch(false); onClear() }} aria-label="Clear selection">
          <X className="size-4" aria-hidden /> Clear
        </Button>
      </span>

      <Dialog open={dialog === 'edit'} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent title={`Change a value on ${n.toLocaleString('en-IN')} ${n === 1 ? table.label.toLowerCase() : table.plural_label.toLowerCase()}`} description="Every selected record gets the same value. Rules and checks still apply to each one. You can undo this for 15 minutes.">
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (chosen) run.mutate(body({ action: 'update', field: chosen.key, value: valueFor(chosen, raw) }))
            }}
          >
            <Field label="Field">
              <Select aria-label="Field to change" value={field} onChange={(e) => { setField(e.target.value); setRaw('') }}>
                <option value="">Choose a field</option>
                {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </Select>
            </Field>
            {chosen && (
              <Field label="New value">
                <ValueInput f={chosen} value={raw} onChange={setRaw} />
              </Field>
            )}
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={!chosen} loading={run.isPending}>Change {n.toLocaleString('en-IN')}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === 'delete'} onOpenChange={(o) => !o && setDialog(null)}>
        {canArchive ? (
          <DialogContent title={`Archive ${n.toLocaleString('en-IN')} ${n === 1 ? table.label.toLowerCase() : table.plural_label.toLowerCase()}?`} description="They leave every list, search and chart. Nothing is deleted yet: restore them from Settings › Archive, or let the auto-delete time pass.">
            {error && <p role="alert" className="mb-3 text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="primary" loading={archiveRecords.isPending} onClick={() => archiveRecords.mutate(body({ action: 'delete' }))}>Archive {n.toLocaleString('en-IN')}</Button>
            </div>
          </DialogContent>
        ) : (
          <DialogContent title={`Delete ${n.toLocaleString('en-IN')} ${n === 1 ? table.label.toLowerCase() : table.plural_label.toLowerCase()}?`} description="They leave the list. You can undo this for 15 minutes, and the history keeps what they held.">
            {error && <p role="alert" className="mb-3 text-sm text-bad">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
              <Button variant="primary" loading={run.isPending} onClick={() => run.mutate(body({ action: 'delete' }))}>Delete {n.toLocaleString('en-IN')}</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
