import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import type { FieldDef, RecordRow, TableDef } from '@/api/types'
import { Input, Select, useToast } from '@/design-system'
import { toFormValue, toPayload } from '@/patterns/RecordForm'

/** The list tells its cells whether editing in place is allowed. */
export const InlineEditContext = createContext<{ table: TableDef } | null>(null)

const NOT_INLINE = new Set(['long_text', 'reference'])
/** The title opens the record, so it is not edited in place. */
export const inlineEditable = (table: TableDef, f: FieldDef) =>
  !f.hidden && !NOT_INLINE.has(f.type) && f.key !== table.title_field && !(table.features?.uneditable ?? []).includes(f.key)

const message = (e: unknown) => (e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : 'Could not save.')

/** A cell that turns into an input on double-click, Enter or F2; Enter saves, Escape leaves it as it was. */
export function InlineCell({ row, f, children }: { row: RecordRow; f: FieldDef; children: ReactNode }) {
  const ctx = useContext(InlineEditContext)
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const [error, setError] = useState('')
  const skip = useRef(false) // Escape must not be followed by a save from the blur it causes
  const start = () => {
    skip.current = false
    setRaw(toFormValue(f, row.data[f.key]))
    setError('')
    setEditing(true)
  }
  const save = useMutation({
    mutationFn: (value: string) => {
      const payload = value === '' ? { [f.key]: null } : toPayload(ctx!.table, { [f.key]: value })
      return app.update(ctx!.table.key, row.id, payload, row.version, crypto.randomUUID())
    },
    onSuccess: async () => {
      setEditing(false)
      await Promise.all(['records', 'count', 'stats', 'facets', 'measures'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.status === 409) {
        toast({ title: 'Someone else changed this record', description: 'The list was refreshed; edit again.', tone: 'bad' })
        setEditing(false)
        await qc.invalidateQueries({ queryKey: ['records'] })
      } else setError(message(e))
    },
  })
  if (!ctx) return <>{children}</>
  const finish = () => {
    if (skip.current) return
    if (raw === toFormValue(f, row.data[f.key])) return setEditing(false)
    save.mutate(raw)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish()
    } else if (e.key === 'Escape') {
      skip.current = true
      setEditing(false)
    }
  }
  if (!editing)
    return (
      <span
        tabIndex={0}
        className="block min-h-6 rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
        title="Double-click to edit"
        onDoubleClick={start}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2') {
            e.preventDefault()
            start()
          }
        }}
      >
        {children}
      </span>
    )
  const label = `${f.label} of ${String(row.data[ctx.table.title_field] ?? 'this row')}`
  const common = { autoFocus: true, 'aria-label': label, 'aria-invalid': error ? true : undefined, onKeyDown: keys, onBlur: finish }
  return (
    <div className="flex min-w-32 flex-col gap-1">
      {f.type === 'select' || f.type === 'boolean' ? (
        <Select {...common} value={raw} onChange={(e) => setRaw(e.target.value)}>
          <option value="">Not set</option>
          {(f.type === 'boolean' ? ['true', 'false'] : f.options).map((o) => (
            <option key={o} value={o}>{f.type === 'boolean' ? (o === 'true' ? 'Yes' : 'No') : o}</option>
          ))}
        </Select>
      ) : (
        <Input
          {...common}
          type={f.type === 'integer' || f.type === 'decimal' ? 'number' : f.type === 'date' ? 'date' : 'text'}
          value={raw}
          disabled={save.isPending}
          onChange={(e) => setRaw(e.target.value)}
        />
      )}
      {error && <span role="alert" className="text-xs text-bad-ink">{error}</span>}
    </div>
  )
}
