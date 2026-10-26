import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { admin, automations, studio, type AutomationAction, type AutomationDraft } from '@/api/endpoints'
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, ErrorState, Field, Input, LoadingState, Select, StageBadge, cn, stageStripe, useToast } from '@/design-system'
import { useStages } from './useStages'
import { useDraftTables } from './useDraftTables'

type Trigger = AutomationDraft['trigger']
const fieldErrors = (e: unknown) => (e instanceof ApiError ? Object.fromEntries(e.errors.map((x) => [x.field, x.message])) : {})
const refresh = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['studio-automations'] })
const OPS: [string, string][] = [
  ['eq', 'is'],
  ['neq', 'is not'],
  ['not_empty', 'is filled in'],
  ['empty', 'is empty'],
]
const BLANK_ACTION: AutomationAction = { kind: 'notify', to: 'owner', role: null, message: '', also_email: false, table: null, values: {}, field: null, value: null }

function useLabels() {
  const tables = useDraftTables()
  const field = (t: string, k?: string | null) => (k === 'created_at' ? 'the date added' : k === 'updated_at' ? 'the date last changed' : tables.data?.find((x) => x.key === t)?.fields.find((f) => f.key === k)?.label ?? k ?? '')
  return { tables, field }
}

const a_ = (word: string) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`

function when(a: AutomationDraft, field: (t: string, k?: string | null) => string) {
  const t = a.trigger
  const one = a_(a.table_label.toLowerCase())
  if (t.kind === 'created') return `When ${one} is added`
  if (t.kind === 'updated') return `When ${one} is changed`
  if (t.kind === 'changed') return `When “${field(t.table, t.field)}” of ${one} becomes ${t.value}`
  const n = Math.abs(t.days)
  const rel = t.days === 0 ? 'On' : `${n} day${n === 1 ? '' : 's'} ${t.days < 0 ? 'before' : 'after'}`
  return `${rel} “${field(t.table, t.field)}” of ${one}`
}

function does(x: AutomationAction, field: (t: string, k?: string | null) => string, tableOf: (k?: string | null) => string, trigTable: string) {
  const who = x.to === 'role' ? `everyone who is ${x.role}` : 'the owner'
  if (x.kind === 'notify') return `tell ${who}${x.also_email ? ' (and email them)' : ''}: “${x.message}”`
  if (x.kind === 'create') return `create ${a_(tableOf(x.table).toLowerCase())} for ${who}`
  return `set ${field(trigTable, x.field)} to ${x.value}`
}

/** Studio > Automations: plain-sentence rules that run after a save or when a date arrives. Draft until published. */
export function AutomationsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const stages = useStages()
  const list = useQuery({ queryKey: ['studio-automations'], queryFn: studio.automations, retry: false })
  const runs = useQuery({ queryKey: ['automation-runs'], queryFn: () => automations.runs({}), retry: false, refetchInterval: 20_000 })
  const { tables, field } = useLabels()
  const [editing, setEditing] = useState<AutomationDraft | 'new' | null>(null)
  const toggle = useMutation({
    mutationFn: (a: AutomationDraft) => studio.saveAutomation(a.key, { enabled: !a.enabled }),
    onSuccess: async (r) => {
      toast({ title: r.enabled ? `Turned on ${r.label}` : `Turned off ${r.label}`, description: 'Saved in Draft. Publish to make it live.', tone: 'ok' })
      await refresh(qc)
    },
    onError: (e) => toast({ title: 'Could not change it', description: (e as Error).message, tone: 'bad' }),
  })
  const retry = useMutation({
    mutationFn: (id: string) => automations.retry(id),
    onSuccess: async (r) => {
      toast({ title: r.status === 'done' ? 'It worked this time' : 'It still did not work', tone: r.status === 'done' ? 'ok' : 'bad' })
      await qc.invalidateQueries({ queryKey: ['automation-runs'] })
    },
    onError: (e) => toast({ title: 'Could not retry', description: (e as Error).message, tone: 'bad' }),
  })
  if (list.isError) return <ErrorState requestId={(list.error as ApiError).requestId} onRetry={() => void list.refetch()} />
  if (!list.data || !tables.data) return <LoadingState label="Loading automations" />
  const tableOf = (k?: string | null) => tables.data.find((t) => t.key === k)?.label ?? k ?? ''
  const failed = runs.data?.filter((r) => r.status === 'failed') ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted">
          {list.data.filter((a) => a.enabled).length} of {list.data.length} are on. They run after a save, never during it. Changes stay in Draft until you publish.
        </p>
        {canEdit && <Button onClick={() => setEditing('new')}>Add an automation</Button>}
      </div>
      {list.data.length === 0 ? (
        <EmptyState title="No automations yet">Tell the app to do something for you when a record is added or a date arrives.</EmptyState>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line" aria-label="Automations">
            {list.data.map((a) => (
              <li key={a.key} className={cn('flex flex-wrap items-center gap-2 p-3', stageStripe(stages.of('automations', a.key)))} data-stage={stages.of('automations', a.key)} data-testid={`automation-row-${a.key}`}>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                    {a.label}
                    {stages.of('automations', a.key) && <StageBadge stage={stages.of('automations', a.key)!} isNew={stages.isNew('automations', a.key)} />}
                  </p>
                  <p className="text-xs text-muted">
                    {when(a, field)}, {a.actions.map((x) => does(x, field, tableOf, a.trigger.table)).join(', then ')}.
                  </p>
                  {a.problems.map((p) => (
                    <p key={p} className="text-xs text-bad">{p}</p>
                  ))}
                </div>
                <Badge tone={a.enabled ? 'ok' : 'neutral'}>{a.enabled ? 'On' : 'Off'}</Badge>
                <Badge>{a.source === 'pack' ? 'Comes with the pack' : 'Yours'}</Badge>
                {canEdit && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => toggle.mutate(a)} disabled={toggle.isPending} aria-label={`${a.enabled ? 'Turn off' : 'Turn on'} ${a.label}`}>
                      {a.enabled ? 'Turn off' : 'Turn on'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setEditing(a)} aria-label={`Edit automation ${a.label}`}>Edit</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <h3 className="text-sm font-semibold text-ink">Recent runs</h3>
        {failed.length > 0 && <p role="status" className="mt-1 text-sm text-bad">{failed.length} run{failed.length === 1 ? '' : 's'} failed. Fix the cause, then retry.</p>}
        {!runs.data?.length ? (
          <p className="mt-1 text-sm text-muted">Nothing has run yet.</p>
        ) : (
          <ul className="mt-1 flex flex-col divide-y divide-line" aria-label="Recent runs" data-testid="automation-runs">
            {runs.data.slice(0, 15).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <Badge tone={r.status === 'done' ? 'ok' : r.status === 'failed' ? 'bad' : 'warn'}>{r.status === 'retrying' ? 'trying again' : r.status}</Badge>
                <span className="font-medium text-ink">{r.label}</span>
                <span className="min-w-0 flex-1 text-xs text-muted">{r.status === 'done' ? r.did.join('; ') : r.error ?? ''}</span>
                <time className="text-xs text-muted" dateTime={r.at}>{new Date(r.at).toLocaleString()}</time>
                {r.status === 'failed' && canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => retry.mutate(r.id)} disabled={retry.isPending} aria-label={`Retry ${r.label}`}>Retry</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && <AutomationDialog automation={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function AutomationDialog({ automation, onClose }: { automation: AutomationDraft | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const { tables } = useLabels()
  const roles = useQuery({ queryKey: ['roles'], queryFn: admin.roles, retry: false })
  const isPack = automation?.source === 'pack'
  const [label, setLabel] = useState(automation?.label ?? '')
  const [help, setHelp] = useState(automation?.help ?? '')
  const [enabled, setEnabled] = useState(automation?.enabled ?? true)
  const [trigger, setTrigger] = useState<Trigger>(automation?.trigger ?? { kind: 'created', table: '', field: null, value: null, days: 0 })
  const [direction, setDirection] = useState<'after' | 'before'>((automation?.trigger.days ?? 0) < 0 ? 'before' : 'after')
  const [absDays, setAbsDays] = useState(Math.abs(automation?.trigger.days ?? 0))
  const [filter, setFilter] = useState(automation?.where[0] ?? { field: '', op: 'eq', value: '' })
  const [actions, setActions] = useState<AutomationAction[]>(automation?.actions ?? [{ ...BLANK_ACTION }])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const t = tables.data?.find((x) => x.key === trigger.table)
  const fields = (t?.fields ?? []).filter((f) => !f.hidden)
  const dates = fields.filter((f) => f.type === 'date')
  const days = trigger.kind === 'date' ? (direction === 'before' ? -absDays : absDays) : 0
  const body = {
    label,
    help,
    enabled,
    trigger: { ...trigger, days, field: trigger.kind === 'created' || trigger.kind === 'updated' ? null : trigger.field || null, value: trigger.kind === 'changed' ? trigger.value : null },
    where: filter.field ? [{ field: filter.field, op: filter.op, ...(['empty', 'not_empty'].includes(filter.op) ? {} : { value: filter.value }) }] : [],
    actions: actions.map((x) => ({ ...x, role: x.to === 'role' ? x.role : null, values: x.kind === 'create' ? x.values : {}, table: x.kind === 'create' ? x.table : null })),
  }
  const ready = !!trigger.table && actions.length > 0
  const preview = useQuery({
    queryKey: ['automation-preview', body],
    queryFn: () => automations.preview(body),
    enabled: ready && !isPack,
    retry: false,
    staleTime: 10_000,
  })
  const save = useMutation({
    mutationFn: () =>
      automation ? studio.saveAutomation(automation.key, isPack ? { label, help, enabled } : body) : studio.addAutomation(body),
    onSuccess: async () => {
      toast({ title: automation ? `Saved ${label}` : `Added ${label}`, description: 'Saved in Draft. Publish to make it live.', tone: 'ok' })
      await refresh(qc)
      onClose()
    },
    onError: (e) => setErrors(fieldErrors(e)),
  })
  const remove = useMutation({
    mutationFn: () => studio.removeAutomation(automation!.key),
    onSuccess: async () => {
      toast({ title: `Removed ${label}`, description: 'Saved in Draft. Publish to make it live.', tone: 'ok' })
      await refresh(qc)
      onClose()
    },
    onError: (e) => toast({ title: 'Could not remove', description: (e as Error).message, tone: 'bad' }),
  })
  const setAction = (i: number, patch: Partial<AutomationAction>) => setActions((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    save.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={automation ? `Edit ${automation.label}` : 'Add an automation'} description={isPack ? 'This automation comes with the pack. You can rename it or switch it off. To change what it does, add a new one.' : 'Say when it should happen and what it should do. Use {title} or {any field} to put values in the text.'}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Name" required error={errors.label}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <Field label="What it is for" hint="Shown under the name." error={errors.help}>
            <Input value={help} onChange={(e) => setHelp(e.target.value)} />
          </Field>
          {!isPack && (
            <>
              <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-muted">When</legend>
                <Field label="Which records" required error={errors['trigger.table']}>
                  <Select value={trigger.table} onChange={(e) => { setTrigger({ ...trigger, table: e.target.value, field: null }); setFilter({ field: '', op: 'eq', value: '' }) }}>
                    <option value="">Choose a table</option>
                    {(tables.data ?? []).map((x) => (
                      <option key={x.key} value={x.key}>{x.plural_label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Happens when">
                  <Select value={trigger.kind} onChange={(e) => setTrigger({ ...trigger, kind: e.target.value as Trigger['kind'], field: null, value: null })}>
                    <option value="created">A record is added</option>
                    <option value="updated">A record is changed</option>
                    <option value="changed">A field changes to a value</option>
                    <option value="date">A date arrives</option>
                  </Select>
                </Field>
                {trigger.kind === 'changed' && (
                  <div className="flex flex-wrap gap-3">
                    <Field label="Field" required error={errors['trigger.field']}>
                      <Select value={trigger.field ?? ''} onChange={(e) => setTrigger({ ...trigger, field: e.target.value })}>
                        <option value="">Choose a field</option>
                        {fields.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Becomes" required error={errors['trigger.value']}>
                      <Input value={String(trigger.value ?? '')} onChange={(e) => setTrigger({ ...trigger, value: e.target.value })} />
                    </Field>
                  </div>
                )}
                {trigger.kind === 'date' && (
                  <div className="flex flex-wrap gap-3">
                    <Field label="Days" error={errors['trigger.days']}>
                      <Input type="number" min={0} max={365} value={absDays} onChange={(e) => setAbsDays(Math.max(0, Number(e.target.value) || 0))} className="w-24" />
                    </Field>
                    <Field label="Before or after">
                      <Select value={direction} onChange={(e) => setDirection(e.target.value as 'after' | 'before')}>
                        <option value="after">After</option>
                        <option value="before">Before</option>
                      </Select>
                    </Field>
                    <Field label="This date" required error={errors['trigger.field']}>
                      <Select value={trigger.field ?? ''} onChange={(e) => setTrigger({ ...trigger, field: e.target.value })}>
                        <option value="">Choose a date</option>
                        <option value="created_at">When the record was added</option>
                        <option value="updated_at">When the record was last changed</option>
                        {dates.map((f) => (
                          <option key={f.key} value={f.key}>{f.label}</option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                )}
                <Field label="Only if (optional)" error={errors['where.0.field'] ?? errors['where.0.value']}>
                  <div className="flex flex-wrap gap-2">
                    <Select aria-label="Condition field" value={filter.field} onChange={(e) => setFilter({ ...filter, field: e.target.value })}>
                      <option value="">No condition</option>
                      {fields.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </Select>
                    {filter.field && (
                      <>
                        <Select aria-label="Condition test" value={filter.op} onChange={(e) => setFilter({ ...filter, op: e.target.value })}>
                          {OPS.map(([k, l]) => (
                            <option key={k} value={k}>{l}</option>
                          ))}
                        </Select>
                        {!['empty', 'not_empty'].includes(filter.op) && <Input aria-label="Condition value" value={String(filter.value ?? '')} onChange={(e) => setFilter({ ...filter, value: e.target.value })} />}
                      </>
                    )}
                  </div>
                </Field>
              </fieldset>
              <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3">
                <legend className="px-1 text-xs font-semibold text-muted">Then</legend>
                {errors.actions && <p role="alert" className="text-xs text-bad">{errors.actions}</p>}
                {actions.map((x, i) => (
                  <ActionEditor
                    key={i}
                    n={i + 1}
                    action={x}
                    fields={fields}
                    tables={tables.data ?? []}
                    roles={roles.data ?? []}
                    errors={errors}
                    onChange={(patch) => setAction(i, patch)}
                    onRemove={actions.length > 1 ? () => setActions((xs) => xs.filter((_, j) => j !== i)) : undefined}
                  />
                ))}
                {actions.length < 5 && (
                  <Button type="button" size="sm" variant="secondary" className="self-start" onClick={() => setActions((xs) => [...xs, { ...BLANK_ACTION }])}>
                    Add another step
                  </Button>
                )}
              </fieldset>
              <div role="status" aria-live="polite" className="rounded-md border border-line bg-canvas p-2 text-sm" data-testid="automation-preview">
                {!ready ? (
                  <span className="text-muted">Pick the records to see how many it would have matched.</span>
                ) : preview.isLoading ? (
                  <span className="text-muted">Counting…</span>
                ) : preview.data ? (
                  <span>
                    Would have matched <b>{preview.data.count}</b> record{preview.data.count === 1 ? '' : 's'}
                    {preview.data.complete ? '' : ' or more'}
                    {preview.data.examples.length ? `, for example ${preview.data.examples.slice(0, 3).join(', ')}` : ''}.
                    {trigger.kind === 'date' ? ' Only dates from the last 7 days are caught up.' : ''}
                  </span>
                ) : (
                  <span className="text-muted">{preview.error instanceof ApiError ? preview.error.errors[0]?.message ?? 'Not ready yet.' : 'Not ready yet.'}</span>
                )}
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Switched on
          </label>
          <div className="flex flex-wrap justify-between gap-2">
            {automation && !isPack ? <Button type="button" variant="secondary" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove automation</Button> : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!label.trim() || (!ready && !automation) || save.isPending}>Save</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ActionEditor({
  n,
  action: x,
  fields,
  tables,
  roles,
  errors,
  onChange,
  onRemove,
}: {
  n: number
  action: AutomationAction
  fields: { key: string; label: string }[]
  tables: { key: string; label: string; plural_label: string; fields: { key: string; label: string; hidden?: boolean; required?: boolean }[] }[]
  roles: { key: string; name: string }[]
  errors: Record<string, string>
  onChange: (patch: Partial<AutomationAction>) => void
  onRemove?: () => void
}) {
  const p = `actions.${n - 1}`
  const target = tables.find((t) => t.key === x.table)
  const rows = Object.entries(x.values)
  return (
    <div className="flex flex-col gap-3 rounded-md bg-canvas p-3" role="group" aria-label={`Step ${n}`}>
      <div className="flex flex-wrap items-end gap-3">
        <Field label={`Step ${n}`}>
          <Select value={x.kind} onChange={(e) => onChange({ kind: e.target.value as AutomationAction['kind'] })}>
            <option value="notify">Tell someone</option>
            <option value="create">Create a record for someone</option>
            <option value="set_field">Set a field on this record</option>
          </Select>
        </Field>
        {x.kind !== 'set_field' && (
          <>
            <Field label="For">
              <Select value={x.to} onChange={(e) => onChange({ to: e.target.value as 'owner' | 'role' })}>
                <option value="owner">The record's owner</option>
                <option value="role">Everyone with a role</option>
              </Select>
            </Field>
            {x.to === 'role' && (
              <Field label="Role" required error={errors[`${p}.role`]}>
                <Select value={x.role ?? ''} onChange={(e) => onChange({ role: e.target.value })}>
                  <option value="">Choose a role</option>
                  {roles.map((r) => (
                    <option key={r.key} value={r.key}>{r.name}</option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}
        {onRemove && <Button type="button" size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove step ${n}`}>Remove</Button>}
      </div>
      {x.kind === 'notify' && (
        <>
          <Field label="Message" required hint="Use {title} or {field} for values." error={errors[`${p}.message`]}>
            <Input value={x.message} onChange={(e) => onChange({ message: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={x.also_email} onChange={(e) => onChange({ also_email: e.target.checked })} /> Also email them (workspace members only)
          </label>
        </>
      )}
      {x.kind === 'create' && (
        <>
          <Field label="What to create" required error={errors[`${p}.table`]}>
            <Select value={x.table ?? ''} onChange={(e) => onChange({ table: e.target.value, values: {} })}>
              <option value="">Choose a table</option>
              {tables.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </Select>
          </Field>
          {target && (
            <div className="flex flex-col gap-2">
              {rows.map(([k, v]) => (
                <div key={k} className="flex flex-wrap items-end gap-2">
                  <Field label={target.fields.find((f) => f.key === k)?.label ?? k} error={errors[`${p}.values.${k}`]}>
                    <Input value={v} onChange={(e) => onChange({ values: { ...x.values, [k]: e.target.value } })} />
                  </Field>
                  <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${k}`} onClick={() => onChange({ values: Object.fromEntries(rows.filter(([kk]) => kk !== k)) })}>Remove</Button>
                </div>
              ))}
              {errors[`${p}.values`] && <p role="alert" className="text-xs text-bad">{errors[`${p}.values`]}</p>}
              <Select aria-label="Add a field to fill in" value="" onChange={(e) => e.target.value && onChange({ values: { ...x.values, [e.target.value]: '' } })}>
                <option value="">Fill in a field…</option>
                {target.fields.filter((f) => !f.hidden && !(f.key in x.values)).map((f) => (
                  <option key={f.key} value={f.key}>{f.label}{f.required ? ' (required)' : ''}</option>
                ))}
              </Select>
            </div>
          )}
        </>
      )}
      {x.kind === 'set_field' && (
        <div className="flex flex-wrap gap-3">
          <Field label="Field" required error={errors[`${p}.field`]}>
            <Select value={x.field ?? ''} onChange={(e) => onChange({ field: e.target.value })}>
              <option value="">Choose a field</option>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="New value" required error={errors[`${p}.value`]}>
            <Input value={x.value ?? ''} onChange={(e) => onChange({ value: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  )
}
