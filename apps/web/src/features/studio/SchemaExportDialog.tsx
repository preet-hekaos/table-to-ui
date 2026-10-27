import { useMutation } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import { Button, Dialog, DialogContent, Field, Select, useToast } from '@/design-system'
import { saveBlob } from '@/features/records/ExportDialog'

const FORMATS = {
  json: 'JSON Schema (.json)',
  sql: 'SQL, CREATE TABLE (.sql)',
  csv: 'Field list for Excel (.csv)',
} as const
type Format = keyof typeof FORMATS

/** Download the Draft's tables, fields and links. JSON and SQL can be imported again with Import schema. */
export function SchemaExportDialog({ open, onOpenChange, tables }: { open: boolean; onOpenChange: (o: boolean) => void; tables: { key: string; label: string }[] }) {
  const toast = useToast()
  const [format, setFormat] = useState<Format>('json')
  const [chosen, setChosen] = useState<Set<string> | null>(null) // null: every table
  const [error, setError] = useState('')
  const picked = chosen ?? new Set(tables.map((t) => t.key))
  const toggle = (k: string, on: boolean) => {
    const next = new Set(picked)
    if (on) next.add(k)
    else next.delete(k)
    setChosen(next)
  }
  const save = useMutation({
    mutationFn: () => studio.schemaExport(format, picked.size === tables.length ? null : [...picked]),
    onSuccess: (blob) => {
      saveBlob(blob, `schema.${format}`)
      toast({ title: 'Schema ready', description: 'The file was saved to your downloads.', tone: 'ok' })
      onOpenChange(false)
    },
    onError: (e) => setError(e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : 'The export failed.'),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Export schema" description="Your Draft's tables, fields and links in one file. No records are included.">
        <div className="flex flex-col gap-3">
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              {(Object.keys(FORMATS) as Format[]).map((f) => <option key={f} value={f}>{FORMATS[f]}</option>)}
            </Select>
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-semibold text-ink">Tables ({picked.size} of {tables.length})</legend>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setChosen(new Set(tables.map((t) => t.key)))}>Select all</Button>
              <Button size="sm" variant="ghost" onClick={() => setChosen(new Set())}>Select none</Button>
            </div>
            <ul className="grid max-h-52 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto">
              {tables.map((t) => (
                <li key={t.key}>
                  <label className="flex items-center gap-2 text-sm text-body">
                    <input type="checkbox" className="size-6" checked={picked.has(t.key)} onChange={(e) => toggle(t.key, e.target.checked)} />
                    {t.label}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={picked.size === 0} loading={save.isPending} onClick={() => { setError(''); save.mutate() }}>
              <Download className="size-4" aria-hidden /> Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
