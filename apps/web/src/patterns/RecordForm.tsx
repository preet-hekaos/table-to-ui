import { useQuery } from '@tanstack/react-query'
import { Link, useBlocker } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import type { FieldDef, RecordRow, RuleOutcome, TableDef } from '@/api/types'
import { Button, Dialog, DialogContent, Field, Input, RuleBlocked, Select, VersionConflict } from '@/design-system'
import { fieldGroups, formatMonths } from './format'

type Values = Record<string, string>

function toPayload(table: TableDef, v: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of table.fields) {
    const raw = v[f.key]
    if (raw === undefined || raw === '') continue
    out[f.key] =
      f.type === 'integer' || f.type === 'decimal'
        ? Number(raw)
        : f.type === 'boolean'
          ? raw === 'true'
          : f.type === 'tags'
            ? raw.split(',').map((t) => t.trim()).filter(Boolean)
            : raw
  }
  return out
}

/** Stored value -> what the person edits: money and durations are shown in the words they type. */
function toFormValue(f: FieldDef, v: unknown): string {
  if (v === null || v === undefined) return ''
  if (f.type === 'tags' && Array.isArray(v)) return v.join(', ')
  if (f.type === 'money') return String(v)
  if (f.type === 'months') return formatMonths(Number(v))
  return String(v)
}

function ReferenceSelect({ f, reg, initial, setValue, ...aria }: { f: FieldDef; reg: UseFormRegisterReturn; initial?: string; setValue: (v: string) => void; id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) {
  const opts = useQuery({ queryKey: ['options', f.ref_table], queryFn: () => app.options(f.ref_table!), staleTime: 30_000 })
  const def = useQuery({ queryKey: ['table', f.ref_table], queryFn: () => app.table(f.ref_table!), staleTime: 60_000 })
  const title = def.data?.table.title_field
  const loaded = !!opts.data
  useEffect(() => {
    if (loaded && initial) setValue(initial) // the options arrive after the form mounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded])
  return (
    <Select {...reg} {...aria}>
      <option value="">{opts.isLoading ? 'Loading…' : 'Not set'}</option>
      {opts.data?.items.map((r) => (
        <option key={r.id} value={r.id}>
          {String((title && r.data[title]) ?? r.id)}
        </option>
      ))}
    </Select>
  )
}

function control(f: FieldDef, reg: UseFormRegisterReturn, initial: string | undefined, setValue: (v: string) => void) {
  if (f.type === 'boolean') {
    return (
      <Select {...reg}>
        <option value="">Not set</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </Select>
    )
  }
  if (f.type === 'select') {
    return (
      <Select {...reg}>
        {!f.required && <option value="">Not set</option>}
        {f.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    )
  }
  if (f.type === 'reference') return <ReferenceSelect f={f} reg={reg} initial={initial} setValue={setValue} />
  if (f.type === 'long_text') return <textarea rows={4} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink" {...reg} />
  const type =
    f.type === 'email' ? 'email' : f.type === 'integer' || f.type === 'decimal' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : f.type === 'phone' ? 'tel' : 'text'
  return <Input type={type} {...reg} />
}

const OutcomeLink = ({ o }: { o: RuleOutcome }) =>
  o.link ? (
    <Link to="/records/$table/$id" params={{ table: o.link.table, id: o.link.id }} className="underline">
      Open {o.link.label}
    </Link>
  ) : null

/** Pattern: a form generated from table metadata, with instant rule checks and server errors beside their fields. */
export function RecordForm({
  table,
  initial,
  prefill,
  onCreated,
}: {
  table: TableDef
  initial?: RecordRow
  prefill?: Record<string, string>
  onCreated: (id: string) => void
}) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const defaults = initial
    ? Object.fromEntries(table.fields.map((f) => [f.key, toFormValue(f, initial.data[f.key])]))
    : { ...Object.fromEntries(table.fields.filter((f) => f.default != null).map((f) => [f.key, String(f.default)])), ...prefill }
  const { register, handleSubmit, setError, getValues, setValue, formState } = useForm<Values>({ defaultValues: defaults })
  const savedRef = useRef(false) // a ref: the save navigates away in the same tick
  const dirty = formState.isDirty // read during render so react-hook-form tracks it
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !savedRef.current,
    enableBeforeUnload: () => dirty && !savedRef.current,
    withResolver: true,
  })
  const [outcomes, setOutcomes] = useState<RuleOutcome[]>([])
  const [blocked, setBlocked] = useState<RuleOutcome | null>(null)
  const [conflict, setConflict] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const checkSeq = useRef(0)

  async function instantCheck() {
    const seq = ++checkSeq.current
    const data = toPayload(table, getValues())
    if (!Object.keys(data).length) return
    try {
      const r = await app.check(table.key, data)
      if (seq === checkSeq.current) setOutcomes(r.outcomes)
    } catch {
      /* the instant check is a convenience; the server still decides on submit */
    }
  }

  // eslint-disable-next-line react-hooks/refs -- savedRef is only written inside the submit handler, never read while rendering
  const submit = handleSubmit(async (values) => {
    setBlocked(null)
    setFailure(null)
    setConflict(false)
    try {
      const rec = initial
        ? await app.update(table.key, initial.id, toPayload(table, values), initial.version, idempotencyKey)
        : await app.create(table.key, toPayload(table, values), idempotencyKey)
      setIdempotencyKey(crypto.randomUUID())
      savedRef.current = true
      onCreated(rec.id)
    } catch (e) {
      if (!(e instanceof ApiError)) return setFailure('Something went wrong. Nothing was saved.')
      if (e.is('rule-blocked')) return setBlocked(e.body.rule as RuleOutcome)
      if (e.is('version-conflict')) return setConflict(true)
      if (e.status === 422 && e.errors.length) {
        let unplaced = false
        for (const fe of e.errors) {
          if (table.fields.some((f) => f.key === fe.field)) setError(fe.field, { message: fe.message[0]?.toUpperCase() + fe.message.slice(1) })
          else unplaced = true
        }
        if (unplaced) setFailure(e.message)
        return
      }
      setFailure(`${e.message}${e.requestId ? ` (request id ${e.requestId})` : ''}`)
    }
  })

  const groups = fieldGroups(table)
  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-5" aria-label={`${initial ? 'Edit' : 'Add'} ${table.label.toLowerCase()}`}>
      {/* eslint-disable-next-line react-hooks/refs -- react-hook-form register() returns ref callbacks by design */}
      {groups.map((g) => {
        const fields = g.fields
        return (
          <fieldset key={g.key} className="rounded-lg border border-line bg-surface p-4">
            <legend className="px-1 text-sm font-semibold text-ink">{g.label}</legend>
            <div className="grid gap-4 md:grid-cols-2">
              {fields.map((f) => {
                const reg = register(f.key, {
                  required: f.required ? `${f.label} is required` : false,
                  onBlur: f.unique || f.normalize === 'text' ? () => void instantCheck() : undefined,
                })
                return (
                  <Field key={f.key} label={f.label} required={f.required} error={formState.errors[f.key]?.message}>
                    {control(f, reg, defaults[f.key], (v) => setValue(f.key, v))}
                  </Field>
                )
              })}
            </div>
          </fieldset>
        )
      })}
      <div aria-live="polite" className="flex flex-col gap-2">
        {outcomes.map((o) => (
          <div
            key={o.check}
            role="status"
            data-testid="instant-check"
            className={`rounded-md border p-3 text-sm ${o.severity === 'block' ? 'border-bad bg-bad-soft text-bad-ink' : 'border-warn bg-warn-soft text-warn-ink'}`}
          >
            <b>{o.severity === 'block' ? 'Possible duplicate: ' : 'Heads up: '}</b>
            {o.message} <OutcomeLink o={o} />
          </div>
        ))}
      </div>
      {blocked && <RuleBlocked ruleId={blocked.rule} message={blocked.message} link={<OutcomeLink o={blocked} />} />}
      {conflict && <VersionConflict onReload={() => window.location.reload()} />}
      {failure && (
        <p role="alert" className="rounded-md bg-bad-soft p-3 text-sm text-bad-ink">
          {failure}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={formState.isSubmitting}>
          Save {table.label.toLowerCase()}
        </Button>
      </div>
      <Dialog open={blocker.status === 'blocked'} onOpenChange={(o) => !o && blocker.reset?.()}>
        <DialogContent title="Leave without saving?" description="You have changes that are not saved yet.">
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => blocker.reset?.()}>Keep editing</Button>
            <Button variant="primary" onClick={() => blocker.proceed?.()}>Discard changes</Button>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  )
}
