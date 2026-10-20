import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { FileUp } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { app, documents, files, type ParseState, type StoredFile } from '@/api/endpoints'
import type { RuleOutcome, ScreenConfig, TableDef } from '@/api/types'
import { Badge, Button, Card, ErrorState, LoadingState, useToast } from '@/design-system'
import { useFileUrl } from '@/features/workspace/useBrand'
import { RecordForm, toFormValue } from './RecordForm'

interface ReviewConfig extends ScreenConfig {
  mapping?: Record<string, string>
}

const ACCEPT = '.pdf,.docx,.png,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg'

function Preview({ file, state }: { file: StoredFile; state?: ParseState }) {
  const url = useFileUrl(file.id)
  if (!url) return <LoadingState label="Loading the document" />
  if (file.content_type === 'application/pdf') return <iframe src={url} title={`Preview of ${file.name}`} className="h-[70vh] w-full rounded-md border border-line bg-surface" />
  if (file.content_type.startsWith('image/')) return <img src={url} alt={`Scan of ${file.name}`} className="max-h-[70vh] w-full rounded-md border border-line object-contain" />
  return (
    <pre className="h-[70vh] overflow-auto rounded-md border border-line bg-surface p-3 text-xs whitespace-pre-wrap text-body" aria-label={`Text of ${file.name}`}>
      {state?.text_preview || 'This document has no readable text.'}
    </pre>
  )
}

/** Pattern "document review": the document beside the fields read from it (S11). Fields the reader
 *  was unsure about are highlighted; when the reader is down the fields are simply typed. */
export function DocumentReview({ screenKey, tableKey, title, config }: { screenKey: string; tableKey: string; title: string; config: ReviewConfig }) {
  const toast = useToast()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const [file, setFile] = useState<StoredFile | null>(null)
  const [state, setState] = useState<ParseState | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const upload = useMutation({
    mutationFn: async (f: File) => {
      setProblem(null)
      const stored = await files.upload('cv', f)
      setFile(stored)
      if (stored.scan_status !== 'clean') throw new Error('This file did not pass the virus scan, so it was not opened. Try another file.')
      return documents.parse(stored.id)
    },
    onSuccess: setState,
    onError: (e) => setProblem(e instanceof ApiError && e.errors.length ? `The file ${e.errors[0]!.message}.` : (e as Error).message),
  })
  const done = async (id: string, attached: boolean) => {
    await qc.invalidateQueries({ queryKey: ['records', tableKey] })
    toast({ title: attached ? 'Document attached' : `${def.data?.table.label ?? 'Record'} added from the document`, tone: 'ok' })
    void navigate({ to: '/records/$table/$id', params: { table: tableKey, id } })
  }
  if (def.error) return <ErrorState requestId={(def.error as ApiError).requestId} onRetry={() => void def.refetch()} />
  if (!def.data) return <LoadingState />
  const table: TableDef = def.data.table
  const prefill = state
    ? Object.fromEntries(
        Object.entries(config.mapping ?? {})
          .filter(([src]) => state.fields[src])
          .map(([src, dst]) => {
            const f = table.fields.find((x) => x.key === dst)
            return [dst, f ? toFormValue(f, state.fields[src]!.value) : String(state.fields[src]!.value)]
          }),
      )
    : {}
  const unsure = new Set(
    Object.entries(config.mapping ?? {})
      .filter(([src]) => state && (state.review.includes(src) || (state.status === 'parsed' && !state.fields[src])))
      .map(([, dst]) => dst),
  )
  const attach = (o: RuleOutcome, markSaved: () => void) =>
    o.link && file ? (
      <Button
        variant="secondary"
        onClick={async () => {
          markSaved()
          const r = await documents.confirm(file.id, { screen: screenKey, existing_id: o.link!.id })
          await done(r.record.id, true)
        }}
      >
        Attach this document to {o.link.label ?? 'the existing record'} instead
      </Button>
    ) : null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      {!file || problem ? (
        <Card className="flex flex-col items-center gap-3 border-dashed py-10 text-center">
          <FileUp className="size-8 text-muted" aria-hidden />
          <p className="text-sm text-body">PDF, Word (DOCX) or a photo, up to 10 MB. It is checked for viruses before anything reads it.</p>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-accent bg-accent px-4 py-2 text-sm font-semibold text-white">
            {upload.isPending ? 'Reading…' : 'Choose a file'}
            <input type="file" accept={ACCEPT} className="sr-only" aria-label="Document to read" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f) }} />
          </label>
          {problem && <p role="alert" className="text-sm text-bad-ink">{problem}</p>}
        </Card>
      ) : !state ? (
        <LoadingState label="Reading the document" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section aria-label="Document" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <b className="text-ink">{file.name}</b>
              <Badge tone="ok">Virus scan passed</Badge>
            </div>
            <Preview file={file} state={state} />
          </section>
          <section aria-label="Details read from the document" className="flex flex-col gap-3">
            {state.status === 'queued' ? (
              <p role="status" className="rounded-md bg-warn-soft p-3 text-sm text-warn-ink" data-testid="parse-queued">
                The document reader is not available right now. The file is saved and queued; fill in the details yourself.
              </p>
            ) : (
              <p role="status" className="text-sm text-muted" data-testid="parse-summary">
                Read {Object.keys(state.fields).length} details. {unsure.size > 0 ? `${unsure.size} need checking (highlighted).` : 'Check them before saving.'}
              </p>
            )}
            <RecordForm
              key={state.file_id + state.attempts}
              table={table}
              prefill={prefill}
              review={unsure}
              submitLabel={`Save ${table.label.toLowerCase()}`}
              blockedAction={attach}
              save={async (payload) => {
                const r = await documents.confirm(file.id, { screen: screenKey, data: payload })
                return { id: r.record.id }
              }}
              onCreated={(id) => void done(id, false)}
            />
          </section>
        </div>
      )}
    </div>
  )
}
