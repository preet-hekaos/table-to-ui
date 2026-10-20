import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { app, files, imports, type ImportDuplicate, type ImportJob } from '@/api/endpoints'
import type { TableDef } from '@/api/types'
import { Badge, Button, Card, CardTitle, Dialog, DialogContent, ErrorState, Field, Input, LoadingState, PermissionDenied, Select, Table, Td, Th, useToast } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'
import { TYPE_LABELS } from '@/features/studio/FieldDialog'

const STEPS = ['Upload', 'Match columns', 'Check', 'Load'] as const
const MARK_TONE = { high: 'ok', medium: 'warn', low: 'bad', none: 'neutral' } as const
const errText = (e: unknown) => (e instanceof ApiError ? (e.errors.length ? e.errors.map((x) => `${x.field} ${x.message}`).join('; ') : e.message) : (e as Error).message)

async function download(id: string) {
  const blob = await imports.errorFile(id)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `import-errors-${id.slice(0, 8)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-2 text-sm" aria-label="Import steps">
      {STEPS.map((s, i) => (
        <li key={s} aria-current={i === step ? 'step' : undefined} className={`rounded-full px-3 py-1 ${i === step ? 'bg-accent text-white' : i < step ? 'bg-accent-soft text-accent-ink' : 'bg-soft text-body'}`}>
          {i + 1}. {s}
        </li>
      ))}
    </ol>
  )
}

function Upload({ onJob }: { onJob: (j: ImportJob) => void }) {
  const me = useMe()
  const tables = useQuery({ queryKey: ['live-tables'], queryFn: app.tables })
  const [table, setTable] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const choices = (tables.data?.tables ?? []).filter((t) => can(me.data?.permissions, `record.${t.key}.create`))
  const current = table || choices[0]?.key || ''
  const go = useMutation({
    mutationFn: async (f: File) => {
      const stored = await files.upload('import', f)
      if (stored.scan_status !== 'clean') throw new Error('This file did not pass the virus scan.')
      return imports.create(stored.id, current)
    },
    onSuccess: onJob,
    onError: (e) => setProblem(errText(e)),
  })
  return (
    <Card className="flex max-w-xl flex-col gap-4">
      <Field label="Import into">
        <Select value={current} onChange={(e) => setTable(e.target.value)}>
          {choices.map((t) => <option key={t.key} value={t.key}>{t.plural_label}</option>)}
        </Select>
      </Field>
      <Field label="Spreadsheet" hint="CSV or Excel (.xlsx), up to 200,000 rows. The first row names the columns.">
        <Input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="pt-1.5" onChange={(e) => { const f = e.target.files?.[0]; setProblem(null); if (f) go.mutate(f) }} />
      </Field>
      {go.isPending && <LoadingState label="Reading the file" />}
      {problem && <p role="alert" className="text-sm text-bad-ink">{problem}</p>}
    </Card>
  )
}

function NewFieldButton({ job, header, onJob }: { job: ImportJob; header: string; onJob: (j: ImportJob) => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState(header)
  const [type, setType] = useState('text')
  const [problem, setProblem] = useState<string | null>(null)
  const toast = useToast()
  const qc = useQueryClient()
  const create = useMutation({
    mutationFn: () => imports.newField(job.id, { header, label, type }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['table', job.table] })
      toast(r.live ? { title: `Created ${label}`, description: 'Published so this import can use it.', tone: 'ok' } : { title: `Created ${label} in Draft`, description: 'An owner must publish it before it can be filled.', tone: 'ok' })
      setOpen(false)
      onJob(r.job)
    },
    onError: (e) => setProblem(errText(e)),
  })
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Create a field for ${header}`}>Create field</Button>
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent title={`New field for “${header}”`} description="It is added to the table and published, so other unpublished Studio changes go live with it.">
            <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
              <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
              <Field label="Type">
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  {Object.entries(TYPE_LABELS).filter(([k]) => !['select', 'reference', 'tags'].includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              {problem && <p role="alert" className="text-sm text-bad-ink">{problem}</p>}
              <Button type="submit" variant="primary" loading={create.isPending}>Create and publish</Button>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function Mapping({ job, table, onJob }: { job: ImportJob; table: TableDef; onJob: (j: ImportJob) => void }) {
  const me = useMe()
  const [mapping, setMapping] = useState(job.mapping)
  const [problem, setProblem] = useState<string | null>(null)
  const next = useMutation({
    mutationFn: async () => {
      await imports.mapping(job.id, mapping)
      return imports.validate(job.id)
    },
    onSuccess: onJob,
    onError: (e) => setProblem(errText(e)),
  })
  const sugg = Object.fromEntries(job.profile.suggestions.map((s) => [s.header, s]))
  const fields = table.fields.filter((f) => !f.hidden)
  const canCreate = can(me.data?.permissions, 'metadata.write')
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {job.profile.rows.toLocaleString('en-IN')} rows. {job.profile.reused_mapping ? 'The matching you saved for these columns was used.' : 'Check each suggestion; unmatched columns can be skipped or made into a new field.'}
      </p>
      <div className="overflow-x-auto">
        <Table aria-label="Columns">
          <thead>
            <tr><Th>Column</Th><Th>Sample values</Th><Th>Blanks</Th><Th>Looks like</Th><Th>Goes into</Th><Th>Match</Th></tr>
          </thead>
          <tbody>
            {job.profile.columns.map((c) => {
              const s = sugg[c.header]
              const chosen = mapping[c.header] ?? ''
              const auto = s?.field && s.field === chosen
              return (
                <tr key={c.header}>
                  <Td className="font-semibold text-ink">{c.header}</Td>
                  <Td className="max-w-56 truncate text-xs">{c.samples.join(' · ') || '—'}</Td>
                  <Td>{c.blanks}</Td>
                  <Td>{c.detected}</Td>
                  <Td>
                    <Select aria-label={`Field for ${c.header}`} value={chosen} onChange={(e) => setMapping({ ...mapping, [c.header]: e.target.value || null })}>
                      <option value="">Skip this column</option>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </Select>
                  </Td>
                  <Td>
                    {chosen ? (
                      auto ? <Badge tone={MARK_TONE[s!.mark]}>{s!.mark} ({Math.round(s!.confidence * 100)}%)</Badge> : <Badge>by hand</Badge>
                    ) : canCreate ? (
                      <NewFieldButton job={job} header={c.header} onJob={(j) => { setMapping(j.mapping); onJob(j) }} />
                    ) : (
                      <span className="text-xs text-muted">skipped</span>
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>
      {problem && <p role="alert" className="text-sm text-bad-ink">{problem}</p>}
      <div><Button variant="primary" onClick={() => next.mutate()} loading={next.isPending}>Check the data</Button></div>
    </div>
  )
}

function DuplicateRow({ d, value, onChange }: { d: ImportDuplicate; value: { action: string; reason?: string }; onChange: (v: { action: string; reason?: string }) => void }) {
  const canUpdate = d.outcomes.some((o) => o.link?.id)
  return (
    <tr>
      <Td>{d.row}</Td>
      <Td className="font-semibold text-ink">{String(d.label ?? '')}</Td>
      <Td className="text-xs">
        {d.outcomes.map((o) => (
          <div key={o.check}>
            <Badge tone={d.severity === 'block' ? 'bad' : 'warn'}>{o.check}</Badge> {o.message}{' '}
            {o.link && (o.link.id ? <span className="text-muted">matches {String(o.link.label ?? '')}</span> : <span className="text-muted">same as row {o.link.row}</span>)}
          </div>
        ))}
      </Td>
      <Td>
        <Select aria-label={`What to do with row ${d.row}`} value={value.action} onChange={(e) => onChange({ ...value, action: e.target.value })}>
          <option value="skip">Skip it</option>
          {canUpdate && <option value="update">Update the existing record</option>}
          <option value="create">Create anyway</option>
        </Select>
        {value.action === 'create' && d.severity === 'block' && (
          <Input aria-label={`Reason for row ${d.row}`} className="mt-1" placeholder="Why create it anyway?" value={value.reason ?? ''} onChange={(e) => onChange({ ...value, reason: e.target.value })} />
        )}
      </Td>
    </tr>
  )
}

function Check({ job, onJob }: { job: ImportJob; onJob: (j: ImportJob) => void }) {
  const r = job.report
  const dups = r.duplicates ?? []
  const [choice, setChoice] = useState<Record<string, { action: string; reason?: string }>>(
    Object.fromEntries(dups.map((d) => [String(d.row), { action: job.resolutions[String(d.row)]?.action ?? d.default, reason: job.resolutions[String(d.row)]?.reason ?? undefined }])),
  )
  const [problem, setProblem] = useState<string | null>(null)
  const load = useMutation({
    mutationFn: async () => {
      if (dups.length) await imports.resolve(job.id, choice)
      return imports.start(job.id)
    },
    onSuccess: onJob,
    onError: (e) => setProblem(errText(e)),
  })
  const creating = (r.valid ?? 0) - Object.values(choice).filter((c) => c.action === 'skip').length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3" data-testid="validation-report">
        <Card><p className="text-xs text-muted">Rows</p><p className="text-2xl font-bold text-ink">{r.rows}</p></Card>
        <Card><p className="text-xs text-muted">Ready</p><p className="text-2xl font-bold text-ok-ink">{r.valid}</p></Card>
        <Card><p className="text-xs text-muted">With problems</p><p className="text-2xl font-bold text-bad-ink">{r.invalid}</p></Card>
      </div>
      {(r.invalid ?? 0) > 0 && (
        <Card>
          <div className="flex items-center gap-2">
            <CardTitle>Problems by reason</CardTitle>
            <Button size="sm" className="ml-auto" onClick={() => void download(job.id)}>Download error file</Button>
          </div>
          <ul className="mt-2 text-sm">{Object.entries(r.by_reason ?? {}).map(([k, n]) => <li key={k}><b className="text-ink">{n}</b> {k}</li>)}</ul>
          <p className="mt-2 text-xs text-muted">These rows are left out. Fix them in the error file and import it again.</p>
        </Card>
      )}
      {dups.length > 0 && (
        <Card className="p-0">
          <h2 className="border-b border-line p-3 text-sm font-bold text-ink">Possible duplicates ({r.duplicates_total})</h2>
          <div className="overflow-x-auto">
            <Table aria-label="Possible duplicates">
              <thead><tr><Th>Row</Th><Th>Name</Th><Th>Why</Th><Th>What to do</Th></tr></thead>
              <tbody>{dups.map((d) => <DuplicateRow key={d.row} d={d} value={choice[String(d.row)]!} onChange={(v) => setChoice({ ...choice, [String(d.row)]: v })} />)}</tbody>
            </Table>
          </div>
        </Card>
      )}
      {problem && <p role="alert" className="text-sm text-bad-ink">{problem}</p>}
      <div><Button variant="primary" onClick={() => load.mutate()} loading={load.isPending} disabled={!r.valid}>Load {Math.max(0, creating).toLocaleString('en-IN')} rows</Button></div>
    </div>
  )
}

function Progress({ jobId }: { jobId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const job = useQuery({ queryKey: ['import', jobId], queryFn: () => imports.get(jobId), refetchInterval: (q) => (q.state.data?.state === 'loading' ? 1000 : false) })
  const undo = useMutation({
    mutationFn: () => imports.undo(jobId),
    onSuccess: async () => { toast({ title: 'Import undone', tone: 'ok' }); await qc.invalidateQueries({ queryKey: ['import', jobId] }); await qc.invalidateQueries({ queryKey: ['import-history'] }) },
    onError: (e) => toast({ title: 'Could not undo', description: errText(e), tone: 'bad' }),
  })
  if (!job.data) return <LoadingState label="Loading progress" />
  const j = job.data
  const c = j.counts
  const handled = c.loaded + c.updated + c.skipped + c.failed
  const pct = c.read ? Math.round((100 * handled) / c.read) : 0
  return (
    <div className="flex flex-col gap-4" data-testid="import-progress">
      {j.state === 'loading' && (
        <div>
          <p className="text-sm text-body" role="status">Loading… {pct}% ({handled.toLocaleString('en-IN')} of {c.read.toLocaleString('en-IN')}). You can leave this page; it carries on.</p>
          <div className="mt-2 h-2 rounded bg-soft" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Import progress"><div className="h-2 rounded bg-accent" style={{ width: `${pct}%` }} /></div>
        </div>
      )}
      {j.state === 'failed' && <ErrorState requestId={undefined} />}
      {(j.state === 'done' || j.state === 'undone') && (
        <Card data-testid="reconciliation">
          <div className="flex items-center gap-2">
            <CardTitle>{j.state === 'undone' ? 'Import undone' : 'Import finished'}</CardTitle>
            <Badge tone={handled === c.read ? 'ok' : 'bad'} className="ml-auto">{handled === c.read ? 'Rows add up' : 'Rows do not add up'}</Badge>
          </div>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Read</dt><dd className="text-ink">{c.read}</dd>
            <dt className="text-muted">Added</dt><dd className="text-ink">{c.loaded}</dd>
            <dt className="text-muted">Updated</dt><dd className="text-ink">{c.updated}</dd>
            <dt className="text-muted">Skipped</dt><dd className="text-ink">{c.skipped}</dd>
            <dt className="text-muted">Failed</dt><dd className="text-ink">{c.failed}</dd>
          </dl>
          <div className="mt-3 flex gap-2">
            {c.failed > 0 && <Button size="sm" onClick={() => void download(jobId)}>Download error file</Button>}
            {j.can_undo && <Button size="sm" variant="danger" onClick={() => undo.mutate()} loading={undo.isPending}>Undo this import</Button>}
          </div>
        </Card>
      )}
    </div>
  )
}

function History({ onOpen }: { onOpen: (id: string) => void }) {
  const h = useQuery({ queryKey: ['import-history'], queryFn: imports.history })
  if (!h.data?.length) return null
  return (
    <Card className="p-0">
      <h2 className="border-b border-line p-3 text-sm font-bold text-ink">Earlier imports</h2>
      <div className="overflow-x-auto">
        <Table aria-label="Import history">
          <thead><tr><Th>File</Th><Th>Into</Th><Th>When</Th><Th>By</Th><Th>State</Th><Th>Added</Th><Th><span className="sr-only">Open</span></Th></tr></thead>
          <tbody>
            {h.data.map((r) => (
              <tr key={r.id}>
                <Td className="font-semibold text-ink">{r.file_name}</Td><Td>{r.table}</Td><Td>{new Date(r.created_at).toLocaleString('en-IN')}</Td><Td>{r.by}</Td>
                <Td><Badge tone={r.state === 'done' ? 'ok' : r.state === 'failed' ? 'bad' : 'neutral'}>{r.state}</Badge></Td><Td>{r.counts.loaded}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => onOpen(r.id)}>Open</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </Card>
  )
}

/** Screens 2.2 and 2.3: upload, match columns, check, load in the background, reconcile, undo. */
export function ImportWizard({ jobId }: { jobId?: string }) {
  const me = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const job = useQuery({ queryKey: ['import', jobId], queryFn: () => imports.get(jobId!), enabled: !!jobId })
  const def = useQuery({ queryKey: ['table', job.data?.table], queryFn: () => app.table(job.data!.table), enabled: !!job.data })
  if (!me.data) return null
  if (!can(me.data.permissions, 'import.run')) return <PermissionDenied what="Importing is for workspace admins and managers." />
  const open = (j: ImportJob | string) => {
    const id = typeof j === 'string' ? j : j.id
    if (typeof j !== 'string') qc.setQueryData(['import', id], j)
    void navigate({ to: '/import', search: { job: id } })
  }
  const j = job.data
  const step = !j ? 0 : j.state === 'uploaded' || j.state === 'mapped' ? 1 : j.state === 'validated' ? 2 : 3
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Import data</h1>
        {j && <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void navigate({ to: '/import', search: {} })}>Start another import</Button>}
      </div>
      <Stepper step={step} />
      {jobId && job.isLoading ? <LoadingState /> : job.error ? <ErrorState requestId={(job.error as ApiError).requestId} /> : null}
      {!jobId && <Upload onJob={open} />}
      {j && step === 1 && def.data && <Mapping key={j.id + JSON.stringify(j.mapping)} job={j} table={def.data.table} onJob={open} />}
      {j && step === 2 && <Check key={j.id} job={j} onJob={open} />}
      {j && step === 3 && <Progress jobId={j.id} />}
      {!jobId && <History onOpen={open} />}
    </div>
  )
}
