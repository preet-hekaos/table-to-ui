import * as Popover from '@radix-ui/react-popover'
import { ArrowDown, ArrowUp, Delete, X } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { studio, type LibraryRule } from '@/api/endpoints'
import type { FieldDef, FieldRule, StudioTable } from '@/api/types'
import { Button, Switch, Tooltip, cn } from '@/design-system'
import { useSaveField } from './useSaveField'
import { useValidationLibrary } from './useValidationLibrary'

/** Types a pattern rule makes sense for: values that are text. Dates only get "not in the future". */
const TEXT_TYPES = new Set(['text', 'long_text', 'email', 'phone', 'url'])
export const rulesApply = (type: FieldDef['type']) => TEXT_TYPES.has(type) || type === 'date'

/** The little fx mark. Drawn with CSS so it never counts as the button's visible text. */
const Fx = () => (
  <span aria-hidden data-tile="fx" className="inline-flex h-5 min-w-6 items-center justify-center rounded bg-accent-soft px-1 font-serif text-xs font-semibold italic text-accent-ink before:content-[attr(data-tile)]" />
)

interface Staged extends FieldRule {
  id: number
  editing?: boolean
}

/** The Validation cell of the Fields grid: an fx button with "Add" or "N rules" that opens the rule list. */
export function ValidationCell({ table, field, canEdit }: { table: StudioTable; field: FieldDef; canEdit: boolean }) {
  const library = useValidationLibrary()
  const save = useSaveField(table.key, field.key, 'validation rules')
  const [open, setOpen] = useState(false)
  const [rules, setRules] = useState<Staged[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [check, setCheck] = useState<string | null>(null)
  const nextId = useRef(1)
  const id = useId()

  if (!rulesApply(field.type)) return <span className="text-muted" aria-label={`${field.label} has no validation rules`}>–</span>
  const saved = field.rules ?? []
  const n = saved.length
  const text = n === 0 ? 'Add' : `${n} ${n === 1 ? 'rule' : 'rules'}`
  const items = (library.data ?? []).filter((i) => (field.type === 'date' ? i.kind === 'not_future' : i.kind === 'pattern'))
  const strip = (r: Staged): FieldRule => ({ name: r.name, kind: r.kind, pattern: r.pattern, message: r.message, enabled: r.enabled })

  const begin = (o: boolean) => {
    setOpen(o)
    if (o) {
      setRules(saved.map((r) => ({ ...r, id: nextId.current++ })))
      setProblem(null)
      setCheck(null)
    }
  }
  const patch = (rid: number, change: Partial<Staged>) => {
    setRules((all) => all.map((r) => (r.id === rid ? { ...r, ...change } : r)))
    setCheck(null)
  }
  const move = (i: number, to: number) => {
    if (to < 0 || to >= rules.length) return
    setRules((all) => {
      const next = [...all]
      const [x] = next.splice(i, 1)
      next.splice(to, 0, x!)
      return next
    })
  }
  const addFromLibrary = (l: LibraryRule) => {
    setRules((all) => [...all, { id: nextId.current++, name: l.name, kind: l.kind, pattern: l.pattern, message: l.message, enabled: true }])
    setCheck(null)
  }
  const addOwn = () => {
    setRules((all) => [...all, { id: nextId.current++, name: 'My pattern', kind: 'pattern', pattern: '', message: 'Enter a valid value.', enabled: true, editing: true }])
    setCheck(null)
  }
  const checkPattern = async (r: Staged) => {
    if (r.kind !== 'pattern') return
    try {
      await studio.validationPreview({ kind: r.kind, pattern: r.pattern }, [])
      setProblem(null)
    } catch (e) {
      setProblem(`${r.name}: ${e instanceof ApiError && e.errors.length ? e.errors[0]!.message : (e as Error).message}`)
    }
  }
  const countExisting = async () => {
    try {
      const { count, checked } = await studio.checkExisting(table.key, field.key, rules.map(strip))
      setCheck(count === 0 ? `None of the ${checked} records with a value break these rules.` : `${count} of ${checked} records with a value break these rules. They stay as they are.`)
    } catch (e) {
      setProblem(e instanceof ApiError && e.errors.length ? e.errors[0]!.message : (e as Error).message)
    }
  }
  const done = () => {
    setProblem(null)
    const next = rules.map(strip)
    if (JSON.stringify(next) === JSON.stringify(saved)) return setOpen(false)
    save.mutate({ rules: next }, {
      onSuccess: () => setOpen(false),
      onError: (e) => setProblem(e instanceof ApiError && e.errors.length ? e.errors[0]!.message : (e as Error).message),
    })
  }

  const trigger = (
    <button
      type="button"
      aria-label={`${text}. Validation of ${field.label}`}
      disabled={!canEdit && n === 0}
      className={cn('flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-sm hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent', n ? 'border-accent bg-accent-soft/50 text-accent-ink' : 'border-line text-muted')}
    >
      <Fx />
      <span>{text}</span>
    </button>
  )
  if (!canEdit) return n ? <span className="flex items-center gap-1.5 text-sm"><Fx />{text}</span> : <span className="text-muted">None</span>

  return (
    <Popover.Root open={open} onOpenChange={begin}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={16}
          aria-label={`Validation for ${field.label}`}
          className="z-50 flex max-h-[var(--radix-popover-content-available-height)] w-[38rem] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-xl"
        >
          <div className="flex items-start gap-3 border-b border-line p-4">
            <Fx />
            <div className="flex-1">
              <p className="font-semibold text-ink">Validation for {field.label}</p>
              <p className="text-xs text-muted">A value must pass every switched-on rule before the record can be saved. Rules run top to bottom.</p>
            </div>
            <Popover.Close aria-label="Close without saving" className="rounded p-1 text-muted hover:bg-soft hover:text-ink"><X className="size-4" aria-hidden /></Popover.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Rules on this field</p>
            {rules.length === 0 && <p className="mt-2 text-sm text-muted">No rules yet. Add one from the library or write your own pattern.</p>}
            <ul className="mt-2 flex flex-col gap-2" aria-label="Rules">
              {rules.map((r, i) => (
                <li key={r.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center gap-2">
                    <Switch label={`${r.name} is on`} checked={r.enabled} onCheckedChange={(on) => patch(r.id, { enabled: on })} />
                    <input aria-label={`Name of rule ${i + 1}`} value={r.name} onChange={(e) => patch(r.id, { name: e.target.value })} className="h-8 w-36 shrink-0 rounded-md border border-transparent px-1.5 text-sm font-semibold text-ink hover:border-line focus:border-accent" />
                    {r.kind === 'pattern' && !r.editing ? (
                      <button type="button" title="Click to edit the pattern" aria-label={`Pattern of ${r.name}: ${r.pattern}. Edit`} onClick={() => patch(r.id, { editing: true })} className="min-w-0 flex-1 truncate rounded bg-accent-soft px-1.5 py-0.5 text-left font-mono text-xs text-accent-ink">{r.pattern}</button>
                    ) : (
                      <span className="flex-1" />
                    )}
                    <button type="button" aria-label={`Move ${r.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"><ArrowUp className="size-4" aria-hidden /></button>
                    <button type="button" aria-label={`Move ${r.name} down`} disabled={i === rules.length - 1} onClick={() => move(i, i + 1)} className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"><ArrowDown className="size-4" aria-hidden /></button>
                    <button type="button" aria-label={`Delete ${r.name}`} onClick={() => { setRules((all) => all.filter((x) => x.id !== r.id)); setCheck(null) }} className="rounded p-1 text-muted hover:text-bad-ink"><Delete className="size-4" aria-hidden /></button>
                  </div>
                  {r.kind === 'pattern' && r.editing && (
                    <input
                      aria-label={`Pattern of ${r.name}`}
                      placeholder="For example ^[A-Z]{5}[0-9]{4}[A-Z]$"
                      value={r.pattern}
                      onChange={(e) => patch(r.id, { pattern: e.target.value })}
                      onBlur={() => checkPattern(r)}
                      className="mt-2 h-8 w-full rounded-md border border-line bg-surface px-2 font-mono text-xs"
                    />
                  )}
                  {r.kind === 'not_future' && <p className="mt-2 text-xs text-muted">Built in: the date cannot be after today.</p>}
                  <input aria-label={`Message of ${r.name}`} value={r.message} onChange={(e) => patch(r.id, { message: e.target.value })} className="mt-2 h-8 w-full rounded-md border border-line bg-surface px-2 text-sm" />
                </li>
              ))}
            </ul>
            {field.max_length ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                <Switch label="Length limit is on" checked disabled onCheckedChange={() => undefined} />
                Built in: at most {field.max_length} characters (from the Length column)
              </p>
            ) : null}
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Add from the library</p>
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Library">
              {items.map((l) => (
                <Tooltip key={l.key} text={`Allowed: ${l.good.join(', ')}. Not allowed: ${l.bad.join(', ')}`}>
                  <button type="button" onClick={() => addFromLibrary(l)} className="rounded-full border border-line px-3 py-1 text-sm font-medium text-ink hover:bg-soft">{l.name}</button>
                </Tooltip>
              ))}
              {field.type !== 'date' && (
                <button type="button" onClick={addOwn} className="rounded-full border border-dashed border-accent px-3 py-1 text-sm font-medium text-accent-ink hover:bg-accent-soft">+ Write my own pattern</button>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" onClick={countExisting} aria-describedby={`${id}-check`}>Check existing records</Button>
              <span id={`${id}-check`} role="status" className="text-xs text-body">{check}</span>
            </div>
            {problem && <p role="alert" className="mt-3 rounded-md border border-bad bg-bad-soft px-3 py-2 text-xs text-bad-ink">{problem}</p>}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={done} loading={save.isPending}>Done</Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
