import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { app } from '@/api/endpoints'
import type { FieldDef } from '@/api/types'
import { Button, Field, Input, Select } from '@/design-system'

function Control({ f, value, onChange }: { f: FieldDef; value: string; onChange: (v: string) => void }) {
  const options = useQuery({ queryKey: ['options', f.ref_table], queryFn: () => app.options(f.ref_table!), enabled: f.type === 'reference' && !!f.ref_table })
  const titleField = useQuery({ queryKey: ['table', f.ref_table], queryFn: () => app.table(f.ref_table!), enabled: f.type === 'reference' && !!f.ref_table })
  if (f.type === 'select') {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    )
  }
  if (f.type === 'reference') {
    const tf = titleField.data?.table.title_field ?? 'id'
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {options.data?.items.map((r) => <option key={r.id} value={r.id}>{String(r.data[tf] ?? r.id)}</option>)}
      </Select>
    )
  }
  if (f.type === 'long_text') {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink" />
  }
  return <Input type={f.type === 'date' ? 'date' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} />
}

/** The details a stage asks for when a record moves into it. Empty answers are left out. */
export function AskFields({ fields, onSubmit, onCancel, submitLabel }: { fields: FieldDef[]; onSubmit: (extra: Record<string, unknown>) => void; onCancel: () => void; submitLabel: string }) {
  const [values, setValues] = useState<Record<string, string>>({})
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== '')))
      }}
    >
      {fields.map((f) => (
        <Field key={f.key} label={f.label} hint={f.help ?? undefined}>
          <Control f={f} value={values[f.key] ?? ''} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        </Field>
      ))}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">{submitLabel}</Button>
      </div>
    </form>
  )
}
