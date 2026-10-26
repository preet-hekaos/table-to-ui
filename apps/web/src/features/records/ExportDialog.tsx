import { useMutation } from '@tanstack/react-query'
import { Download, Mail } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { app, type ExportBody } from '@/api/endpoints'
import type { FieldDef, TableDef } from '@/api/types'
import { Button, Dialog, DialogContent, Field, Select, useToast } from '@/design-system'
import type { TableFeatures } from '@/features/studio/features'

const NAMES = { csv: 'CSV (opens in Excel)', xlsx: 'Excel (.xlsx)', json: 'JSON' } as const
const problem = (e: unknown) => (e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : 'The export failed.')

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Choose a format and which columns, then download the file or have a link emailed. */
export function ExportDialog({
  open,
  onOpenChange,
  table,
  feat,
  shown,
  request,
  count,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  table: TableDef
  feat: TableFeatures
  /** The columns the list shows. */
  shown: FieldDef[]
  /** The search, or the ticked ids, this export covers. */
  request: Omit<ExportBody, 'format' | 'fields'>
  /** What is being exported, in words ("3 selected", "everything in this search"). */
  count: string
}) {
  const toast = useToast()
  const formats = feat.export_formats
  const [format, setFormat] = useState<ExportBody['format']>(formats[0] ?? 'csv')
  const [columns, setColumns] = useState<'shown' | 'all'>(feat.bulk_scope === 'all' ? 'all' : 'shown')
  const [error, setError] = useState('')
  const body = (): ExportBody => ({ ...request, format, fields: columns === 'shown' ? shown.map((f) => f.key) : undefined })
  const download = useMutation({
    mutationFn: () => app.exportFile(table.key, body()),
    onSuccess: (blob) => {
      saveBlob(blob, `${table.plural_label.toLowerCase().replace(/\s+/g, '-')}.${format}`)
      toast({ title: 'Export ready', description: 'The file was saved to your downloads.', tone: 'ok' })
      onOpenChange(false)
    },
    onError: (e) => setError(problem(e)),
  })
  const email = useMutation({
    mutationFn: () => app.exportEmail(table.key, body()),
    onSuccess: (r) => {
      toast({ title: 'Link sent', description: `Check ${r.sent_to}. It works for 7 days, for you only.`, tone: 'ok' })
      onOpenChange(false)
    },
    onError: (e) => setError(problem(e)),
  })
  const canEmail = feat.export_email && !request.ids
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Export ${table.plural_label.toLowerCase()}`} description={`${count}. Only what you are allowed to see is included.`}>
        <div className="flex flex-col gap-3">
          <Field label="Format">
            <Select value={format} onChange={(e) => setFormat(e.target.value as ExportBody['format'])}>
              {formats.map((f) => <option key={f} value={f}>{NAMES[f]}</option>)}
            </Select>
          </Field>
          <Field label="Columns">
            <Select value={columns} onChange={(e) => setColumns(e.target.value as 'shown' | 'all')}>
              <option value="shown">The columns shown in the list</option>
              <option value="all">Every field</option>
            </Select>
          </Field>
          {error && <p role="alert" className="text-sm text-bad">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            {canEmail && (
              <Button variant="secondary" loading={email.isPending} onClick={() => { setError(''); email.mutate() }}>
                <Mail className="size-4" aria-hidden /> Email me a link
              </Button>
            )}
            <Button variant="primary" loading={download.isPending} onClick={() => { setError(''); download.mutate() }}>
              <Download className="size-4" aria-hidden /> Download
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** The page an emailed link opens: sign in, then the file is built from what you can see now. */
export function ExportLink({ token }: { token: string }) {
  const [done, setDone] = useState(false)
  const get = useMutation({
    mutationFn: () => app.exportLink(token),
    onSuccess: (blob) => {
      saveBlob(blob, 'export')
      setDone(true)
    },
  })
  return (
    <div className="flex max-w-xl flex-col gap-3">
      <h1 className="text-xl font-bold text-ink">Your export</h1>
      <p className="text-sm text-body">The file is built when you open it, from what you can see now.</p>
      <div>
        <Button variant="primary" loading={get.isPending} onClick={() => get.mutate()}>
          <Download className="size-4" aria-hidden /> Download the file
        </Button>
      </div>
      {done && <p role="status" className="text-sm text-ok-ink">Saved to your downloads.</p>}
      {get.isError && <p role="alert" className="text-sm text-bad">{problem(get.error)}</p>}
    </div>
  )
}
