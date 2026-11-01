import { useRef, useState, type KeyboardEvent } from 'react'
import type { FieldDef, StudioTable } from '@/api/types'
import { cn } from '@/design-system'
import { useSaveField } from './useSaveField'

/** Types whose values are text, so a maximum length means something. */
export const LENGTH_TYPES = new Set(['text', 'long_text', 'email', 'phone', 'url'])

/** The maximum length of a text-like field, in the Fields grid. Click to edit; Enter saves to the Draft, Esc cancels. */
export function LengthCell({ table, field, canEdit }: { table: StudioTable; field: FieldDef; canEdit: boolean }) {
  const save = useSaveField(table.key, field.key, 'length')
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cancelled = useRef(false)

  if (!LENGTH_TYPES.has(field.type)) return <span className="text-muted" aria-label={`${field.label} has no length`}>–</span>
  const shown = field.max_length ?? null
  const text = shown ? String(shown) : 'No limit'
  if (!canEdit) return <span>{text}</span>

  const commit = () => {
    if (cancelled.current) return
    const t = value.trim()
    const next = t === '' ? null : Number(t)
    if (next !== null && (!Number.isInteger(next) || next < 1)) {
      setError('Use a whole number of 1 or more, or leave it empty for no limit.')
      return
    }
    if (next === shown) {
      setEditing(false)
      setError(null)
      return
    }
    save.mutate({ max_length: next } as Partial<FieldDef>, {
      onSuccess: () => { setEditing(false); setError(null) },
      onError: (e) => setError((e as Error).message),
    })
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    else if (e.key === 'Escape') { e.preventDefault(); cancelled.current = true; setError(null); setEditing(false) }
  }

  if (!editing)
    return (
      <button
        type="button"
        title="Click to change the maximum length"
        aria-label={`Maximum length of ${field.label}: ${text}`}
        className={cn('-mx-1 rounded px-1 text-left hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent', !shown && 'text-muted')}
        onClick={() => { cancelled.current = false; setValue(shown ? String(shown) : ''); setEditing(true) }}
      >
        {text}
      </button>
    )
  return (
    <span className="flex flex-col">
      <input
        autoFocus
        inputMode="numeric"
        aria-label={`Maximum length of ${field.key}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `len-err-${field.key}` : undefined}
        value={value}
        disabled={save.isPending}
        onChange={(e) => { setValue(e.target.value); setError(null) }}
        onKeyDown={onKey}
        onBlur={commit}
        className={cn('h-8 w-24 rounded-md border bg-surface px-2 text-sm text-ink', error ? 'border-bad' : 'border-accent')}
      />
      {error && <span id={`len-err-${field.key}`} role="alert" className="mt-0.5 max-w-40 text-xs text-bad-ink">{error}</span>}
    </span>
  )
}
