import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import type { FieldDef, RuleOutcome, TableDef } from '@/api/types'
import { Button, Field, Input, RuleBlocked, Select, VersionConflict } from '@/design-system'

type Values = Record<string, string>

function toPayload(table: TableDef, v: Values): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of table.fields) {
    const raw = v[f.key]
    if (raw === undefined || raw === '') continue
    out[f.key] = f.type === 'integer' || f.type === 'decimal' ? Number(raw) : f.type === 'boolean' ? raw === 'true' : raw
  }
  return out
}

function control(f: FieldDef, reg: UseFormRegisterReturn) {
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
export function RecordForm({ table, onCreated }: { table: TableDef; onCreated: (id: string) => void }) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const defaults = Object.fromEntries(table.fields.filter((f) => f.default != null).map((f) => [f.key, String(f.default)]))
  const { register, handleSubmit, setError, getValues, formState } = useForm<Values>({ defaultValues: defaults })
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

  const submit = handleSubmit(async (values) => {
    setBlocked(null)
    setFailure(null)
    setConflict(false)
    try {
      const rec = await app.create(table.key, toPayload(table, values), idempotencyKey)
      setIdempotencyKey(crypto.randomUUID())
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

  const groups = table.groups.length ? table.groups : [{ key: '_', label: 'Details' }]
  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-5" aria-label={`Add ${table.label.toLowerCase()}`}>
      {/* eslint-disable-next-line react-hooks/refs -- react-hook-form register() returns ref callbacks by design */}
      {groups.map((g) => {
        const fields = table.fields.filter((f) => (table.groups.length ? f.group === g.key : true))
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
                    {control(f, reg)}
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
    </form>
  )
}
