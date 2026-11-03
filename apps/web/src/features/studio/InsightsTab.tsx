import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { app, studio } from '@/api/endpoints'
import type { MeasureDraft } from '@/api/types'
import { ArchiveDialog } from '@/features/archive/ArchiveDialog'
import { Badge, Button, Card, Dialog, SideContent, EmptyState, ErrorState, Field, Input, LoadingState, Select, useToast } from '@/design-system'
import { useDraftTables } from './useDraftTables'

const NUMERIC = ['integer', 'decimal', 'money', 'months']
const OPS: [string, string][] = [
  ['eq', 'is'],
  ['neq', 'is not'],
  ['gt', 'is more than'],
  ['lt', 'is less than'],
  ['not_empty', 'is filled in'],
  ['empty', 'is empty'],
]
const fieldErrors = (e: unknown) => (e instanceof ApiError ? Object.fromEntries(e.errors.map((x) => [x.field.split('.').pop() ?? x.field, x.message])) : {})
const refresh = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['studio-measures'] })

function sentence(m: MeasureDraft, fieldLabel: (t: string, k: string | null) => string) {
  const what = m.aggregate === 'count' ? `Number of ${m.table_label.toLowerCase()} records` : `${{ sum: 'Total', avg: 'Average', distinct: 'Different values of' }[m.aggregate]} ${fieldLabel(m.table, m.field)}`
  const by = m.group_by ? `, one bar per ${fieldLabel(m.table, m.group_by)}` : m.by_time ? `, per ${m.by_time}` : ''
  return `${what}${by}`
}

/** Studio > Insights: the numbers on the Insights page and Home. Changes stay in Draft until published. */
export function InsightsTab({ canEdit }: { canEdit: boolean }) {
  const list = useQuery({ queryKey: ['studio-measures'], queryFn: studio.measures, retry: false })
  const tables = useDraftTables()
  const [editing, setEditing] = useState<MeasureDraft | 'new' | null>(null)
  if (list.isError) return <ErrorState requestId={(list.error as ApiError).requestId} onRetry={() => void list.refetch()} />
  if (!list.data || !tables.data) return <LoadingState label="Loading measures" />
  const label = (t: string, k: string | null) => tables.data.find((x) => x.key === t)?.fields.find((f) => f.key === k)?.label ?? k ?? ''
  const homeCount = list.data.filter((m) => m.home && !m.hidden).length
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted">
          {list.data.length} measures. {homeCount} on Home (up to 4). Changes stay in Draft until you publish.
        </p>
        {canEdit && <Button onClick={() => setEditing('new')}>Add a measure</Button>}
      </div>
      {list.data.length === 0 ? (
        <EmptyState title="No measures yet" />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line" aria-label="Measures">
            {list.data.map((m) => (
              <li key={m.key} className="flex flex-wrap items-center gap-2 p-3" data-testid={`measure-row-${m.key}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{m.label}</p>
                  <p className="text-xs text-muted">{sentence(m, label)}{m.time_field ? ` · by ${m.time_field === 'created_at' ? 'date added' : label(m.table, m.time_field)}` : ''}</p>
                  {m.problems.map((p) => (
                    <p key={p} className="text-xs text-bad">{p}</p>
                  ))}
                </div>
                {m.home && <Badge>On Home</Badge>}
                {m.hidden && <Badge>Hidden</Badge>}
                <Badge>{m.source === 'pack' ? 'Comes with the pack' : 'Yours'}</Badge>
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => setEditing(m)} aria-label={`Edit measure ${m.label}`}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {editing && <MeasureDialog measure={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function MeasureDialog({ measure, onClose }: { measure: MeasureDraft | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const tables = useDraftTables()
  const isPack = measure?.source === 'pack'
  const [label, setLabel] = useState(measure?.label ?? '')
  const [help, setHelp] = useState(measure?.help ?? '')
  const [table, setTable] = useState(measure?.table ?? '')
  const [aggregate, setAggregate] = useState(measure?.aggregate ?? 'count')
  const [field, setField] = useState(measure?.field ?? '')
  const [shape, setShape] = useState<'number' | 'bars' | 'trend'>(measure?.display ?? 'number')
  const [groupBy, setGroupBy] = useState(measure?.group_by ?? '')
  const [byTime, setByTime] = useState<'day' | 'week' | 'month'>(measure?.by_time ?? 'week')
  const [timeField, setTimeField] = useState(measure?.time_field ?? '')
  const [filter, setFilter] = useState(measure?.where[0] ?? { field: '', op: 'eq', value: '' })
  const [home, setHome] = useState(measure?.home ?? false)
  const [hidden, setHidden] = useState(measure?.hidden ?? false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const t = tables.data?.find((x) => x.key === table)
  const fields = (t?.fields ?? []).filter((f) => !f.hidden)
  const body = {
    label,
    help: help || null,
    table,
    aggregate,
    field: aggregate === 'count' ? null : field || null,
    display: shape,
    group_by: shape === 'bars' ? groupBy || null : null,
    by_time: shape === 'trend' ? byTime : null,
    time_field: shape === 'trend' || timeField ? timeField || null : null,
    where: filter.field ? [{ field: filter.field, op: filter.op, ...(['empty', 'not_empty'].includes(filter.op) ? {} : { value: filter.value }) }] : [],
    home,
    hidden,
  }
  const preview = useQuery({
    queryKey: ['measure-preview', body],
    queryFn: () => app.previewMeasure(body),
    enabled: !!table && !isPack && !!label.trim(),
    retry: false,
    staleTime: 10_000,
  })
  const save = useMutation({
    mutationFn: () => (measure ? studio.saveMeasure(measure.key, isPack ? { label, help: help || null, hidden, home } : body) : studio.addMeasure(body)),
    onSuccess: async (r) => {
      toast({
        title: measure ? `Saved ${label}` : `Added ${label}`,
        description: r.fields_turned_on?.length ? `Switched on for Insights: ${r.fields_turned_on.join(', ')}. Saved in Draft; publish to make it live.` : 'Saved in Draft. Publish to make it live.',
        tone: 'ok',
      })
      await refresh(qc)
      onClose()
    },
    onError: (e) => setErrors(fieldErrors(e)),
  })
  const [archiving, setArchiving] = useState(false)
  const numeric = fields.filter((f) => NUMERIC.includes(f.type))
  const choices = fields.filter((f) => f.type === 'select' || f.type === 'boolean')
  const dates = fields.filter((f) => f.type === 'date')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    save.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SideContent
        title={measure ? `Edit ${measure.label}` : 'Add a measure'}
        description={isPack ? 'This measure comes with the pack. You can rename it, hide it or put it on Home. To change what it counts, add a new measure.' : 'A measure is a number your team can trust. It always reads from the same records.'}
        footer={(
          <>
            {measure && !isPack ? (
              <Button type="button" variant="secondary" onClick={() => setArchiving(true)}>Archive measure…</Button>
            ) : <span />}
            <span className="flex-1" />
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" form="side-form" disabled={!label.trim() || !table && !measure || save.isPending}>Save</Button>
          </>
        )}
      >
        <form id="side-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Name" required error={errors.label}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <Field label="Help text" hint="Shown under the name." error={errors.help}>
            <Input value={help} onChange={(e) => setHelp(e.target.value)} />
          </Field>
          {!isPack && (
            <>
              <Field label="Count records in" required error={errors.table}>
                <Select value={table} onChange={(e) => { setTable(e.target.value); setField(''); setGroupBy(''); setTimeField(''); setFilter({ field: '', op: 'eq', value: '' }) }}>
                  <option value="">Choose a table</option>
                  {(tables.data ?? []).map((x) => (
                    <option key={x.key} value={x.key}>{x.plural_label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="What to work out" error={errors.aggregate}>
                <Select value={aggregate} onChange={(e) => setAggregate(e.target.value as typeof aggregate)}>
                  <option value="count">How many records</option>
                  <option value="sum">Total of a number field</option>
                  <option value="avg">Average of a number field</option>
                  <option value="distinct">How many different values</option>
                </Select>
              </Field>
              {aggregate !== 'count' && (
                <Field label="Field" required error={errors.field}>
                  <Select value={field} onChange={(e) => setField(e.target.value)}>
                    <option value="">Choose a field</option>
                    {(aggregate === 'distinct' ? fields : numeric).map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label="Only records where (optional)" error={errors['where.0.field'] ?? errors.where}>
                <div className="flex flex-wrap gap-2">
                  <Select aria-label="Filter field" value={filter.field} onChange={(e) => setFilter({ ...filter, field: e.target.value })}>
                    <option value="">No filter</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </Select>
                  {filter.field && (
                    <>
                      <Select aria-label="Filter test" value={filter.op} onChange={(e) => setFilter({ ...filter, op: e.target.value })}>
                        {OPS.map(([k, l]) => (
                          <option key={k} value={k}>{l}</option>
                        ))}
                      </Select>
                      {!['empty', 'not_empty'].includes(filter.op) && <Input aria-label="Filter value" value={String(filter.value ?? '')} onChange={(e) => setFilter({ ...filter, value: e.target.value })} />}
                    </>
                  )}
                </div>
              </Field>
              <Field label="Show as" error={errors.display}>
                <Select value={shape} onChange={(e) => setShape(e.target.value as typeof shape)}>
                  <option value="number">One number</option>
                  <option value="bars">Bars, one per choice</option>
                  <option value="trend">A line over time</option>
                </Select>
              </Field>
              {shape === 'bars' && (
                <Field label="One bar for each" required error={errors.group_by}>
                  <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option value="">Choose a field</option>
                    {choices.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </Select>
                </Field>
              )}
              {shape === 'trend' && (
                <div className="flex flex-wrap gap-3">
                  <Field label="Follow the date" required error={errors.time_field}>
                    <Select value={timeField} onChange={(e) => setTimeField(e.target.value)}>
                      <option value="">Choose a date</option>
                      <option value="created_at">When the record was added</option>
                      {dates.map((f) => (
                        <option key={f.key} value={f.key}>{f.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="One point per">
                    <Select value={byTime} onChange={(e) => setByTime(e.target.value as typeof byTime)}>
                      <option value="day">Day</option>
                      <option value="week">Week</option>
                      <option value="month">Month</option>
                    </Select>
                  </Field>
                </div>
              )}
              {shape !== 'trend' && (
                <Field label="Limit to the chosen dates by (optional)" hint="Leave empty for a number that shows how things are right now.">
                  <Select value={timeField} onChange={(e) => setTimeField(e.target.value)}>
                    <option value="">Right now, no dates</option>
                    <option value="created_at">When the record was added</option>
                    {dates.map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </Select>
                </Field>
              )}
              <div role="status" aria-live="polite" className="rounded-md border border-line bg-canvas p-2 text-sm" data-testid="measure-preview">
                {!table || !label.trim() ? (
                  <span className="text-muted">Pick a name and a table to see the number.</span>
                ) : preview.isLoading ? (
                  <span className="text-muted">Working it out…</span>
                ) : preview.data?.ok ? (
                  <span>Would show <b>{preview.data.card?.value ?? 'no data'}</b> with today's records (last 30 days for dated measures).</span>
                ) : (
                  <span className="text-muted">{preview.data?.problems?.[0] ?? 'Not available yet.'} {preview.data?.note}</span>
                )}
              </div>
            </>
          )}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={home} onChange={(e) => setHome(e.target.checked)} /> Show on Home (up to 4)
          </label>
          {errors.home && <p role="alert" className="text-xs text-bad">{errors.home}</p>}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide from Insights
          </label>
        </form>
      </SideContent>
      {archiving && (
        <ArchiveDialog kind="measure" itemKey={measure!.key} label={measure!.label} onClose={() => setArchiving(false)} onArchived={() => { setArchiving(false); onClose() }} />
      )}
    </Dialog>
  )
}
