import { useMutation, useQueryClient } from '@tanstack/react-query'
import { FileUp, Upload } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { ApiError } from '@/api/client'
import { studio, type SchemaField, type SchemaPreview, type SchemaTable } from '@/api/endpoints'
import { Badge, Button, Dialog, DialogContent, Input, Select, cn, useToast } from '@/design-system'
import { TYPE_LABELS } from './FieldDialog'

const ACCEPT = '.csv,.tsv,.xlsx,.json,.sql'

/** What each part of a file becomes, and the one thing a person must do next. */
const rowsNote = (t: SchemaTable) => (t.rows > 0 ? `Schema + ${t.rows.toLocaleString('en-IN')} rows` : 'Schema only')

interface Row {
  table: SchemaTable
  include: boolean
  /** Field keys whose link the person has ticked. */
  links: Set<string>
}

function toRows(p: SchemaPreview): Row[] {
  return p.tables.map((table) => ({
    table,
    include: true,
    links: new Set(table.fields.filter((f) => f.link).map((f) => f.key)),
  }))
}

/** Drop CSV, Excel, JSON or SQL files, check what would be created, then create it in the Draft. */
export function SchemaImportDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (key: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [problems, setProblems] = useState<SchemaPreview['problems']>([])
  const [error, setError] = useState('')

  const read = useMutation({
    mutationFn: (files: File[]) => studio.schemaPreview(files),
    onSuccess: (p) => {
      setProblems(p.problems)
      setRows(p.tables.length ? toRows(p) : null)
      setError('')
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'The files could not be read.'),
  })

  const chosen = (rows ?? []).filter((r) => r.include)
  const create = useMutation({
    mutationFn: () => {
      const keys = new Set(chosen.map((r) => r.table.key))
      const tables = chosen.map(({ table, links }) => ({
        ...table,
        fields: table.fields.map((f) =>
          f.link && links.has(f.key) && keys.has(f.link.to) ? { ...f, type: 'reference' as const, ref_table: f.link.to, required: false } : f,
        ),
      }))
      return studio.schemaApply(tables)
    },
    onSuccess: async (r) => {
      const withData = chosen.filter((c) => c.table.rows > 0).length
      toast({
        title: `Created ${r.tables.length} ${r.tables.length === 1 ? 'table' : 'tables'} in Draft`,
        description: withData
          ? `${withData} of the files also had data. Publish, then use Import data on that table to load it.`
          : 'Publish to make them live, then use Import data to add records.',
        tone: 'ok',
      })
      await Promise.all(['studio-tables', 'studio-status', 'studio-nav', 'studio-screens', 'studio-relationships', 'studio-layout'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      onOpenChange(false)
      setRows(null)
      onCreated?.(r.tables[0]!)
    },
    onError: (e) => setError(e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : 'Nothing was created.'),
  })

  const take = (list: FileList | null) => {
    const files = Array.from(list ?? [])
    if (files.length) read.mutate(files)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    take(e.dataTransfer.files)
  }
  const edit = (ti: number, fn: (t: SchemaTable) => SchemaTable) =>
    setRows((rs) => rs && rs.map((r, i) => (i === ti ? { ...r, table: fn(r.table) } : r)))
  const editField = (ti: number, fi: number, patch: Partial<SchemaField>) =>
    edit(ti, (t) => ({ ...t, fields: t.fields.map((f, i) => (i === fi ? { ...f, ...patch } : f)) }))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setRows(null)
          setProblems([])
          setError('')
        }
        onOpenChange(o)
      }}
    >
      <DialogContent
        wide
        title="Import schema"
        description="Drop CSV, Excel, JSON or SQL files. You see the tables they would make before anything is created."
      >
        {!rows ? (
          <div className="flex flex-col gap-3">
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
              className={cn('flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center', over ? 'border-accent bg-accent-soft' : 'border-line bg-canvas')}
            >
              <Upload className="size-6 text-muted" aria-hidden />
              <p className="text-sm text-body">Drop files here, or</p>
              <Button variant="secondary" loading={read.isPending} onClick={() => input.current?.click()}>
                <FileUp className="size-4" aria-hidden /> Choose files
              </Button>
              <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Schema files" onChange={(e) => take(e.target.files)} />
              <p className="text-xs text-muted">CSV (one table), Excel (one table per sheet), JSON (a list of objects or a JSON Schema) and SQL (CREATE TABLE). Up to 5 MB each.</p>
            </div>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            {problems.map((p) => (
              <p key={p.file + p.message} role="alert" className="text-sm text-bad">{p.file ? `${p.file}: ` : ''}{p.message}</p>
            ))}
          </div>
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              setError('')
              create.mutate()
            }}
          >
            <p className="text-sm text-muted">Nothing is created until you confirm. Names and types can be changed here. New tables start in Draft.</p>
            {problems.map((p) => (
              <p key={p.file + p.message} role="alert" className="text-sm text-bad">{p.file ? `${p.file}: ` : ''}{p.message}</p>
            ))}
            <ul className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto" aria-label="Tables to create">
              {rows.map((r, ti) => (
                <li key={r.table.key} className={cn('rounded-lg border border-line p-3', !r.include && 'opacity-60')} data-testid={`schema-table-${r.table.key}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <input type="checkbox" checked={r.include} onChange={(e) => setRows((rs) => rs && rs.map((x, i) => (i === ti ? { ...x, include: e.target.checked } : x)))} />
                      <span className="sr-only">Create </span>
                      <Input aria-label={`Name of table ${r.table.key}`} className="w-48" value={r.table.label} onChange={(e) => edit(ti, (t) => ({ ...t, label: e.target.value, plural_label: '' }))} />
                    </label>
                    <Badge tone={r.table.rows > 0 ? 'accent' : 'neutral'}>{rowsNote(r.table)}</Badge>
                    <span className="text-xs text-muted">from {r.table.source}</span>
                  </div>
                  {r.table.warnings.map((w) => <p key={w} className="mt-1 text-xs text-warn-ink">{w}</p>)}
                  {r.include && (
                    <ul className="mt-2 divide-y divide-line" aria-label={`Fields of ${r.table.label}`}>
                      {r.table.fields.map((f, fi) => (
                        <li key={f.key} className="flex flex-wrap items-center gap-2 py-1.5">
                          <Input aria-label={`Name of field ${f.key} in ${r.table.key}`} className="w-44" value={f.label} onChange={(e) => editField(ti, fi, { label: e.target.value })} />
                          <Select aria-label={`Type of ${f.key} in ${r.table.key}`} className="w-44" value={f.type} onChange={(e) => editField(ti, fi, { type: e.target.value as SchemaField['type'] })}>
                            {Object.entries(TYPE_LABELS)
                              .filter(([k]) => k !== 'reference' && (k !== 'select' || f.options.length > 0 || f.type === 'select'))
                              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </Select>
                          <label className="flex items-center gap-1 text-xs text-body">
                            <input type="checkbox" checked={f.required} disabled={r.links.has(f.key)} onChange={(e) => editField(ti, fi, { required: e.target.checked })} /> Required
                          </label>
                          {f.link && (
                            <label className="flex items-center gap-1 text-xs text-accent-ink">
                              <input
                                type="checkbox"
                                checked={r.links.has(f.key)}
                                onChange={(e) =>
                                  setRows((rs) =>
                                    rs && rs.map((x, i) => {
                                      if (i !== ti) return x
                                      const links = new Set(x.links)
                                      if (e.target.checked) links.add(f.key)
                                      else links.delete(f.key)
                                      return { ...x, links }
                                    }),
                                  )
                                }
                              />
                              Link to {rows.find((x) => x.table.key === f.link!.to)?.table.label ?? f.link.to} ({f.link.reason})
                            </label>
                          )}
                          {f.options.length > 0 && <span className="text-xs text-muted">Choices: {f.options.join(', ')}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
            {error && <p role="alert" className="text-sm text-bad">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => { setRows(null); setError('') }}>Choose other files</Button>
              <Button type="submit" variant="primary" disabled={chosen.length === 0} loading={create.isPending}>
                Create {chosen.length} {chosen.length === 1 ? 'table' : 'tables'} in Draft
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
