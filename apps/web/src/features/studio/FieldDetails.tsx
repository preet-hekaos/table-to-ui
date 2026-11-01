import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import type { FieldDef, StudioTable } from '@/api/types'
import { useSaveField } from './useSaveField'

/** The panel under a row: help text, the choices of a list, and where a link points. */
export function FieldDetails({ table, tables, field, canEdit }: { table: StudioTable; tables: StudioTable[]; field: FieldDef; canEdit: boolean }) {
  const saveHelp = useSaveField(table.key, field.key, 'help text')
  const saveOptions = useSaveField(table.key, field.key, 'choices')
  const [help, setHelp] = useState(field.help ?? '')
  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const options = field.options ?? []
  const isList = field.type === 'select' || field.type === 'tags'

  const commitHelp = () => {
    const next = help.trim()
    if (next === (field.help ?? '')) return
    saveHelp.mutate({ help: next || null })
  }
  const setOptions = (next: string[]) => saveOptions.mutate({ options: next })
  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (options.some((o) => o.toLowerCase() === v.toLowerCase())) {
      setProblem(`${v} is already a choice.`)
      return
    }
    setProblem(null)
    setDraft('')
    setOptions([...options, v])
  }
  const move = (i: number, to: number) => {
    if (to < 0 || to >= options.length) return
    const next = [...options]
    const [x] = next.splice(i, 1)
    next.splice(to, 0, x!)
    setOptions(next)
  }
  const onAddKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      add()
    }
  }
  const target = field.ref_table ? (tables.find((t) => t.key === field.ref_table)?.label ?? field.ref_table) : null

  return (
    <div className="flex flex-wrap gap-x-10 gap-y-4 bg-soft/50 py-3 pl-12 pr-4" data-testid={`details-${field.key}`}>
      <div className="min-w-72 flex-1">
        <label htmlFor={`help-${field.key}`} className="block text-[11px] font-semibold uppercase tracking-wide text-muted">Help text</label>
        <input
          id={`help-${field.key}`}
          value={help}
          disabled={!canEdit}
          onChange={(e) => setHelp(e.target.value)}
          onBlur={commitHelp}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commitHelp())}
          className="mt-1 h-9 w-full rounded-md border border-line bg-surface px-2 text-sm text-ink"
        />
        <p className="mt-1 text-xs text-muted">Shown under the field on forms.</p>
      </div>
      {isList && (
        <div className="min-w-72 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Choices</p>
          <ul className="mt-1 flex flex-wrap gap-1.5" aria-label={`Choices of ${field.label}`}>
            {options.map((o, i) => (
              <li key={o} className="flex items-center gap-1 rounded-full border border-line bg-surface py-0.5 pl-2.5 pr-1 text-xs text-ink">
                {o}
                {canEdit && (
                  <>
                    <button type="button" aria-label={`Move ${o} earlier`} disabled={i === 0} onClick={() => move(i, i - 1)} className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30">
                      <ArrowLeft className="size-3" aria-hidden />
                    </button>
                    <button type="button" aria-label={`Move ${o} later`} disabled={i === options.length - 1} onClick={() => move(i, i + 1)} className="rounded p-0.5 text-muted hover:text-ink disabled:opacity-30">
                      <ArrowRight className="size-3" aria-hidden />
                    </button>
                    <button type="button" aria-label={`Remove ${o}`} onClick={() => setOptions(options.filter((x) => x !== o))} className="rounded p-0.5 text-muted hover:text-bad-ink">
                      <X className="size-3" aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <input
              aria-label={`Add a choice to ${field.label}`}
              placeholder="Type a choice and press Enter"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setProblem(null) }}
              onKeyDown={onAddKey}
              className="mt-2 h-8 w-64 rounded-md border border-line bg-surface px-2 text-sm"
            />
          )}
          {problem && <p role="alert" className="mt-1 text-xs text-bad-ink">{problem}</p>}
          <p className="mt-1 text-xs text-muted">The first choice is used when a value is blank.</p>
        </div>
      )}
      {target && (
        <div className="min-w-48">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Links to</p>
          <p className="mt-1 text-sm text-ink">{target}</p>
        </div>
      )}
    </div>
  )
}
