import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type KeyboardEvent } from 'react'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { FieldDef, StudioTable } from '@/api/types'
import { cn, useToast } from '@/design-system'

/** The label of a field in the Studio grid. Click to edit; Enter or leaving the cell saves to the Draft, Esc cancels. */
export function InlineLabel({ table, field, canEdit }: { table: StudioTable; field: FieldDef; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(field.label)
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  const problem = (v: string): string | null => {
    const t = v.trim()
    if (!t) return 'A label is required.'
    if (table.fields.some((f) => f.key !== field.key && f.label.trim().toLowerCase() === t.toLowerCase())) return `Another field is already called ${t}.`
    return null
  }
  const save = useMutation({
    mutationFn: (label: string) => studio.updateField(table.key, field.key, { label }),
    onSuccess: async () => {
      setEditing(false)
      setError(null)
      await qc.invalidateQueries({ queryKey: ['studio-tables'] })
      await qc.invalidateQueries({ queryKey: ['studio-status'] })
    },
    onError: (e) => {
      const msg = e instanceof ApiError && e.errors.length ? e.errors[0]!.message : (e as Error).message
      setError(msg)
      toast({ title: 'Could not save the label', description: msg, tone: 'bad' })
    },
  })
  const commit = () => {
    if (cancelled.current) return
    const next = value.trim()
    if (next === field.label) {
      setEditing(false)
      setError(null)
      return
    }
    const p = problem(next)
    if (p) {
      setError(p)
      return
    }
    save.mutate(next)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelled.current = true
      setValue(field.label)
      setError(null)
      setEditing(false)
    }
  }

  if (!canEdit)
    return <span>{field.label}</span>
  if (!editing)
    return (
      <button
        type="button"
        title="Click to rename"
        className="-mx-1 rounded px-1 text-left hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => {
          cancelled.current = false
          setValue(field.label)
          setEditing(true)
        }}
      >
        {field.label}
      </button>
    )
  return (
    <span className="flex flex-col">
      <input
        autoFocus
        aria-label={`Label of ${field.key}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `label-err-${field.key}` : undefined}
        value={value}
        disabled={save.isPending}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
        }}
        onKeyDown={onKey}
        onBlur={commit}
        className={cn('h-8 w-full min-w-40 rounded-md border bg-surface px-2 text-sm font-medium text-ink', error ? 'border-bad' : 'border-accent')}
      />
      {error && (
        <span id={`label-err-${field.key}`} role="alert" className="mt-0.5 text-xs text-bad-ink">
          {error}
        </span>
      )}
    </span>
  )
}
