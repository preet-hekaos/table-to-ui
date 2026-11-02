import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { studio } from '@/api/endpoints'
import type { FieldDef, StudioTable, TransformDo, TransformRule, TransformWhen } from '@/api/types'
import { Button, Dialog, DialogContent, Input, Select, Switch, cn } from '@/design-system'
import { useQuery as useQ } from '@tanstack/react-query'
import { ai } from '@/api/endpoints'
import { WordsPanel } from './WordsPanel'
import { CASES, DO, WHEN, describeRule, emptyRule, isComplete } from './transforms'
import { useSaveField } from './useSaveField'

type Staged = TransformRule & { id: number }

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

const useStandard = () => {
  const q = useQuery({ queryKey: ['studio-standard-values'], queryFn: studio.standardValues, staleTime: 300_000, retry: false })
  return q.data ?? []
}

/** The Transformation column: the first rule in short form and "+N more"; opens the rule builder. */
export function TransformCell({ table, field, canEdit }: { table: StudioTable; field: FieldDef; canEdit: boolean }) {
  const [open, setOpen] = useState(false)
  const standard = useStandard()
  const map = Object.fromEntries(standard.map((s) => [s.key, s.label]))
  const saved = field.transforms ?? []
  const first = saved.find((r) => r.enabled) ?? saved[0]
  const more = saved.length - 1
  const text = first ? describeRule(first, table.fields, map) : 'Add'
  return (
    <>
      <button
        type="button"
        data-testid={`transform-of-${field.key}`}
        onClick={() => setOpen(true)}
        aria-label={`${text}${more > 0 ? ` +${more} more` : ''}. Transformation rules of ${field.label}`}
        className={cn(
          'inline-flex max-w-[16rem] items-center gap-1 truncate rounded-md border px-2 py-0.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          first ? 'border-accent/40 bg-accent-soft text-accent-ink' : 'border-dashed border-line text-muted hover:bg-soft',
        )}
      >
        <Wand2 className="size-3 shrink-0" aria-hidden />
        <span className="truncate" aria-hidden>{text}</span>
        {more > 0 && <span aria-hidden className="font-semibold">+{more} more</span>}
      </button>
      {open && <TransformDialog table={table} field={field} canEdit={canEdit} onClose={() => setOpen(false)} />}
    </>
  )
}

function TransformDialog({ table, field, canEdit, onClose }: { table: StudioTable; field: FieldDef; canEdit: boolean; onClose: () => void }) {
  const standard = useStandard()
  const save = useSaveField(table.key, field.key, 'transformation rules')
  const next = useRef(1000)
  const [rules, setRules] = useState<Staged[]>(() => (field.transforms ?? []).map((r, n) => ({ ...r, id: n + 1 })))
  const [bWhen, setBWhen] = useState<TransformWhen | ''>('')
  const [bDo, setBDo] = useState<TransformDo | ''>('')
  const [samples, setSamples] = useState<string[]>([''])
  const id = useId()
  const aiSetting = useQ({ queryKey: ['ai', 'settings'], queryFn: ai.settings, staleTime: 60_000, retry: false })
  const others = table.fields.filter((f) => f.key !== field.key)

  const put = (i: number, c: Partial<TransformRule>) => setRules((all) => all.map((r, j) => (j === i ? { ...r, ...c } : r)))
  const move = (i: number, to: number) => {
    if (to < 0 || to >= rules.length) return
    setRules((all) => {
      const n = [...all]
      const [x] = n.splice(i, 1)
      n.splice(to, 0, x!)
      return n
    })
  }
  const addMany = (rs: TransformRule[]) => setRules((all) => [...all, ...rs.map((r) => ({ ...r, id: next.current++ }))])
  const add = (w: TransformWhen, d: TransformDo) => {
    setRules((all) => [...all, { ...emptyRule(w, d), id: next.current++ }])
    setBWhen('')
    setBDo('')
  }
  const pickWhen = (w: TransformWhen) => {
    if (bDo) add(w, bDo)
    else setBWhen(w)
  }
  const pickDo = (d: TransformDo) => {
    if (bWhen) add(bWhen, d)
    else setBDo(d)
  }

  const sendable = rules.filter(isComplete).map((r): TransformRule => ({ when: r.when, args: r.args.filter((a) => a.trim() !== ''), do: r.do, value: r.value, stop: r.stop, enabled: r.enabled }))
  const probe = useDebounced(JSON.stringify({ r: sendable, s: samples.filter((s) => s !== '') }), 300)
  const preview = useQuery({
    queryKey: ['transform-preview', table.key, field.key, probe],
    queryFn: () => {
      const p = JSON.parse(probe) as { r: TransformRule[]; s: string[] }
      return studio.transformPreview(table.key, field.key, p.r, p.s.map((value) => ({ value })))
    },
    enabled: JSON.parse(probe).s.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const results = preview.data?.results ?? []
  const filled = samples.filter((s) => s !== '')

  const done = () => {
    if (!canEdit) return onClose()
    save.mutate({ transforms: sendable }, { onSuccess: onClose })
  }
  const incomplete = rules.length - sendable.length

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Transformation rules · ${field.label}`} description="Each rule says: if this, then that. They run when a record is saved, from forms, imports and the list, before validation. Imported files are never changed." wide>
        <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
          <div className="flex flex-col gap-3" aria-label="Palette">
            <div>
              <p className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">If this … (conditions)</p>
              <div className="flex flex-wrap gap-1.5">
                {WHEN.filter((w) => w.key !== 'below').map((w) => (
                  <button key={w.key} type="button" disabled={!canEdit} onClick={() => pickWhen(w.key)} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', bWhen === w.key ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-body hover:bg-soft')}>
                    {w.palette}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold tracking-wide text-muted uppercase">Then … (actions)</p>
              <div className="flex flex-wrap gap-1.5">
                {DO.map((d) => (
                  <button key={d.key} type="button" disabled={!canEdit} onClick={() => pickDo(d.key)} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', bDo === d.key ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-body hover:bg-soft')}>
                    {d.palette}
                  </button>
                ))}
              </div>
            </div>
            <p className="rounded-md border border-line bg-soft p-2 text-xs text-body">
              <b>Standard values</b> depend on the type. Dates offer Today, choices the first choice, text “Not provided”, numbers zero. Rules run top to bottom; a rule marked “and stop” ends the list when it applies.
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-xs font-bold tracking-wide text-muted uppercase">Rules on this field</p>
            {rules.length === 0 && <p className="text-sm text-muted">No rules yet. Pick a condition and an action, or use the row below.</p>}
            <ol aria-label="Rules" className="flex flex-col gap-2">
              {rules.map((r, i) => (
                <li key={r.id} className={cn('rounded-lg border border-line p-3', !r.enabled && 'opacity-60')} aria-label={`Rule ${i + 1}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-6 place-items-center rounded-full bg-soft text-xs font-semibold">{i + 1}</span>
                    <span className="text-xs font-bold text-accent-ink">IF</span>
                    <Select aria-label={`Rule ${i + 1} condition`} disabled={!canEdit} className="w-44" value={r.when === 'below' ? 'above' : r.when} onChange={(e) => put(i, { when: e.target.value as TransformWhen, args: [] })}>
                      {WHEN.filter((w) => w.key !== 'below').map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                    </Select>
                    <WhenArgs r={r} i={i} others={others} canEdit={canEdit} put={put} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                    <span className="text-xs font-bold text-accent-ink">THEN</span>
                    <Select aria-label={`Rule ${i + 1} action`} disabled={!canEdit} className="w-52" value={r.do} onChange={(e) => put(i, { do: e.target.value as TransformDo, value: e.target.value === 'case' ? 'title' : '' })}>
                      {DO.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                    </Select>
                    <DoValue r={r} i={i} others={others} standard={standard} canEdit={canEdit} put={put} />
                    <label className="flex items-center gap-1 text-xs text-body">
                      <input type="checkbox" disabled={!canEdit} checked={r.stop} onChange={(e) => put(i, { stop: e.target.checked })} className="size-3.5" />
                      and stop
                    </label>
                    <span className="ml-auto flex items-center gap-1">
                      <Switch label={`Rule ${i + 1} is on`} checked={r.enabled} disabled={!canEdit} onCheckedChange={(on) => put(i, { enabled: on })} />
                      <Button type="button" size="sm" variant="ghost" aria-label={`Move rule ${i + 1} up`} disabled={!canEdit || i === 0} onClick={() => move(i, i - 1)}><ArrowUp className="size-3.5" aria-hidden /></Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={`Move rule ${i + 1} down`} disabled={!canEdit || i === rules.length - 1} onClick={() => move(i, i + 1)}><ArrowDown className="size-3.5" aria-hidden /></Button>
                      <Button type="button" size="sm" variant="ghost" aria-label={`Delete rule ${i + 1}`} disabled={!canEdit} onClick={() => setRules((all) => all.filter((_, j) => j !== i))}><Trash2 className="size-3.5" aria-hidden /></Button>
                    </span>
                  </div>
                  {!isComplete(r) && <p className="mt-1 pl-8 text-xs text-warn-ink">Fill in the missing part; this rule is not saved until it is complete.</p>}
                </li>
              ))}
            </ol>

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-3" role="group" aria-label="Add a rule">
                <Plus className="size-4 text-accent-ink" aria-hidden />
                <span className="text-xs font-bold text-accent-ink">IF</span>
                <Select aria-label="New rule condition" className="w-44" value={bWhen} onChange={(e) => pickWhen(e.target.value as TransformWhen)}>
                  <option value="">choose a condition</option>
                  {WHEN.filter((w) => w.key !== 'below').map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
                </Select>
                <span className="text-xs font-bold text-accent-ink">THEN</span>
                <Select aria-label="New rule action" className="w-52" value={bDo} onChange={(e) => pickDo(e.target.value as TransformDo)}>
                  <option value="">choose an action</option>
                  {DO.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </Select>
              </div>
            )}

            <section aria-labelledby={`${id}-try`} className="rounded-lg border border-line p-3">
              <h3 id={`${id}-try`} className="text-xs font-bold tracking-wide text-muted uppercase">Try a value</h3>
              <p className="mb-2 text-xs text-muted">The real saving function runs on what you type, so this is what will happen live.</p>
              <ul className="flex flex-col gap-1.5" aria-label="Values to try">
                {samples.map((s, i) => {
                  const k = filled.indexOf(s)
                  const res = s !== '' ? results[k] : undefined
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <Input aria-label={`Value to try ${i + 1}`} className="w-52" placeholder="Try a value…" value={s} onChange={(e) => setSamples((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
                      {res && (
                        <span data-testid={`try-result-${i}`} className="flex flex-wrap items-center gap-2">
                          <span aria-hidden>→</span>
                          <code className="rounded bg-soft px-1.5 py-0.5 text-xs">{res.output === null || res.output === '' ? '(empty)' : String(res.output)}</code>
                          <span className="text-xs text-muted">
                            {res.steps.some((st) => st.matched) ? res.steps.filter((st) => st.matched).map((st) => `rule ${st.rule} applied${st.stopped ? ', stopped' : ''}`).join(', ') : 'no rule applied'}
                          </span>
                          {res.problem && <span className="text-xs text-bad-ink">Then it would be refused: {res.problem}</span>}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
              <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setSamples((all) => [...all, ''])}>+ Another value</Button>
            </section>
            {canEdit && <WordsPanel aiOn={!!aiSetting.data?.enabled} label={field.label} type={field.type} describe={(r) => describeRule(r, table.fields, Object.fromEntries(standard.map((x) => [x.key, x.label])))} onUse={addMany} />}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <p className="text-xs text-muted">{incomplete > 0 ? `${incomplete} unfinished ${incomplete === 1 ? 'rule is' : 'rules are'} left out when you press Done. ` : ''}Changes go to the Draft with the field.</p>
          <span className="flex-1" />
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          {canEdit && <Button variant="primary" loading={save.isPending} onClick={done}>Done</Button>}
        </div>
      </DialogContent>
    </Dialog>
  )
}

type PutFn = (i: number, c: Partial<TransformRule>) => void

function WhenArgs({ r, i, others, canEdit, put }: { r: TransformRule; i: number; others: FieldDef[]; canEdit: boolean; put: PutFn }) {
  const name = `Rule ${i + 1}`
  if (r.when === 'blank') return null
  if (r.when === 'field_is')
    return (
      <>
        <Select aria-label={`${name} other field`} disabled={!canEdit} className="w-40" value={r.args[0] ?? ''} onChange={(e) => put(i, { args: [e.target.value, r.args[1] ?? ''] })}>
          <option value="">choose a field</option>
          {others.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        <span className="text-xs text-body">is</span>
        <Input aria-label={`${name} other field value`} disabled={!canEdit} className="w-36" value={r.args[1] ?? ''} onChange={(e) => put(i, { args: [r.args[0] ?? '', e.target.value] })} />
      </>
    )
  if (r.when === 'equals_any')
    return <Input aria-label={`${name} values`} disabled={!canEdit} className="w-64" placeholder="immediate, serving, ASAP" value={r.args.join(', ')} onChange={(e) => put(i, { args: e.target.value.split(',').map((x) => x.replace(/^\s+/, '')) })} />
  return (
    <Input
      aria-label={`${name} ${r.when === 'matches' ? 'pattern' : 'condition value'}`}
      disabled={!canEdit}
      className={cn('w-56', r.when === 'matches' && 'font-mono')}
      placeholder={r.when === 'matches' ? '^(\\d+)\\s*days?$' : r.when === 'above' || r.when === 'below' ? 'a number' : 'text'}
      value={r.args[0] ?? ''}
      onChange={(e) => put(i, { args: [e.target.value] })}
    />
  )
}

function DoValue({ r, i, others, standard, canEdit, put }: { r: TransformRule; i: number; others: FieldDef[]; standard: { key: string; label: string }[]; canEdit: boolean; put: PutFn }) {
  const name = `Rule ${i + 1}`
  switch (r.do) {
    case 'set':
      return <Input aria-label={`${name} action value`} disabled={!canEdit} className="w-40" placeholder="value" value={r.value} onChange={(e) => put(i, { value: e.target.value })} />
    case 'set_standard':
      return (
        <Select aria-label={`${name} standard value`} disabled={!canEdit} className="w-44" value={r.value} onChange={(e) => put(i, { value: e.target.value })}>
          <option value="">choose one</option>
          {standard.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </Select>
      )
    case 'copy_field':
      return (
        <Select aria-label={`${name} field to copy`} disabled={!canEdit} className="w-44" value={r.value} onChange={(e) => put(i, { value: e.target.value })}>
          <option value="">choose a field</option>
          {others.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
      )
    case 'case':
      return (
        <Select aria-label={`${name} case`} disabled={!canEdit} className="w-36" value={r.value} onChange={(e) => put(i, { value: e.target.value })}>
          {CASES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Select>
      )
    case 'remove_chars':
      return <Input aria-label={`${name} characters to remove`} disabled={!canEdit} className="w-36" placeholder="- ( )" value={r.value} onChange={(e) => put(i, { value: e.target.value })} />
    case 'keep_match':
      return r.when === 'matches' ? <span className="rounded-full bg-soft px-2 py-0.5 text-xs">the part in brackets, or the whole match</span> : <span className="rounded-full bg-soft px-2 py-0.5 text-xs">the first number in it</span>
    default:
      return null
  }
}
