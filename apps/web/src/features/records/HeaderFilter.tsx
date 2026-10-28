import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownAZ, ArrowUpAZ, Filter } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDebounced } from '@/lib/useDebounced'
import { app } from '@/api/endpoints'
import type { FieldDef } from '@/api/types'
import { Button, Input, ScrollArea, cn } from '@/design-system'

export const VALUE_LIST_MAX = 200

export interface FilterCriteria {
  filters: Record<string, string>
  ranges: Record<string, string>
  contains: Record<string, string>
  anyof: Record<string, string>
}

export const TEXTY = new Set(['text', 'long_text', 'email', 'phone', 'url'])
export const NUMERIC = new Set(['integer', 'decimal', 'money', 'months'])

/** Which header filter a field gets, or null when it has none. */
export const filterKind = (f: FieldDef): 'text' | 'choices' | 'tags' | 'reference' | 'boolean' | 'number' | 'date' | null =>
  TEXTY.has(f.type) ? 'text' : f.type === 'select' ? 'choices' : f.type === 'tags' ? 'tags' : f.type === 'reference' ? 'reference' : f.type === 'boolean' ? 'boolean' : NUMERIC.has(f.type) ? 'number' : f.type === 'date' ? 'date' : null

/** What is currently asked of this field, as a short phrase for a chip; empty when nothing. */
export function describe(f: FieldDef, c: FilterCriteria, labels: Record<string, string> = {}): string {
  const kind = filterKind(f)
  if (kind === 'text') {
    if (c.contains[f.key]) return `${f.label} contains “${c.contains[f.key]}”`
    const v = c.anyof[f.key]
    return v ? `${f.label}: ${v.split(',').map((x) => labels[x] ?? x).join(', ')}` : ''
  }
  if (kind === 'choices' || kind === 'tags' || kind === 'reference') {
    const v = c.anyof[f.key]
    return v ? `${f.label}: ${v.split(',').map((x) => labels[x] ?? x).join(', ')}` : ''
  }
  if (kind === 'boolean') return c.filters[f.key] ? `${f.label}: ${c.filters[f.key] === 'true' ? 'Yes' : 'No'}` : ''
  const r = c.ranges[f.key]
  if (!r) return ''
  const [lo, hi] = r.split('..')
  return `${f.label}: ${lo && hi ? `${lo} to ${hi}` : lo ? `from ${lo}` : `up to ${hi}`}`
}

const withoutOwn = (c: FilterCriteria, key: string): FilterCriteria => {
  const drop = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).filter(([k]) => k !== key))
  return { filters: drop(c.filters), ranges: drop(c.ranges), contains: drop(c.contains), anyof: drop(c.anyof) }
}

const SORT_WORDS = {
  text: ['Sort A to Z', 'Sort Z to A'],
  number: ['Sort smallest to largest', 'Sort largest to smallest'],
  date: ['Sort oldest to newest', 'Sort newest to oldest'],
} as const

/**
 * The Excel-style value list: every value the column holds with its count, a search box, Select all,
 * and nothing narrowed until Apply. Counts follow the rest of the search, not this column's own choice.
 */
function ValueList({
  f, tableKey, q, criteria, picked, onPick, onLabels, onView,
}: {
  f: FieldDef
  tableKey: string
  q: string
  criteria: FilterCriteria
  picked: Set<string> | null
  onPick: (next: Set<string> | null) => void
  onLabels: (m: Record<string, string>) => void
  /** What the list shows right now, so Apply can use a typed search as the choice (as Excel does). */
  onView: (shown: string[], searched: boolean) => void
}) {
  const [typed, setTyped] = useState('')
  const search = useDebounced(typed, 250)
  const rest = withoutOwn(criteria, f.key)
  const list = useQuery({
    queryKey: ['values', tableKey, f.key, q, rest, search],
    queryFn: () => app.values(tableKey, f.key, { q, ...rest, search, limit: VALUE_LIST_MAX }),
    placeholderData: (prev) => prev,
  })
  const data = list.data
  useEffect(() => {
    if (!data) return
    onLabels(Object.fromEntries(data.values.map((v) => [v.value, v.label])))
    onView(data.values.map((v) => v.value), search.trim() !== '')
  }, [data, onLabels, onView, search])
  const all = useRef<HTMLInputElement>(null)
  const values = data?.values ?? []
  const everything = !data?.truncated // with a long list nothing starts ticked: the others cannot be named
  const on = (v: string) => (picked ? picked.has(v) : everything)
  const ticked = values.filter((v) => on(v.value)).length
  useEffect(() => {
    if (all.current) all.current.indeterminate = ticked > 0 && ticked < values.length
  }, [ticked, values.length])
  const base = () => new Set(picked ?? (everything ? values.map((v) => v.value) : []))
  const flip = (v: string, yes: boolean) => {
    const n = base()
    if (yes) n.add(v)
    else n.delete(v)
    onPick(n)
  }
  const flipAll = (yes: boolean) => {
    const n = base()
    for (const v of values) {
      if (yes) n.add(v.value)
      else n.delete(v.value)
    }
    onPick(n)
  }
  return (
    <div className="flex flex-col gap-2">
      <Input aria-label={`Search ${f.label} values`} type="search" placeholder="Search values" value={typed} onChange={(e) => setTyped(e.target.value)} />
      {list.isLoading && <p className="text-xs text-muted">Loading values…</p>}
      {data && values.length === 0 && <p className="text-xs text-muted">{typed ? 'No value matches.' : 'No values yet.'}</p>}
      {values.length > 0 && (
        <ScrollArea as="fieldset" className="flex max-h-56 min-w-0 flex-col overflow-x-hidden rounded-md border border-line">
          <legend className="sr-only">Values in {f.label}</legend>
          <label className="flex min-h-8 items-center gap-2 border-b border-line px-2 text-sm font-semibold text-ink">
            <input ref={all} type="checkbox" className="size-4" checked={ticked === values.length} onChange={(e) => flipAll(e.target.checked)} />
            {typed ? 'Select all results' : 'Select all'}
          </label>
          {values.map((v) => (
            <label key={v.value} title={v.label} className="flex min-h-8 min-w-0 items-center gap-2 px-2 text-sm text-body hover:bg-soft">
              <input type="checkbox" className="size-4 shrink-0" checked={on(v.value)} onChange={(e) => flip(v.value, e.target.checked)} />
              <span className="min-w-0 flex-1 truncate">{v.label}</span>
              <span className="shrink-0 text-xs text-muted">{v.count}</span>
            </label>
          ))}
        </ScrollArea>
      )}
      {data?.truncated && <p className="text-xs text-muted">Showing the first {VALUE_LIST_MAX} values. Type to narrow the list{f.type === 'select' || f.type === 'tags' || f.type === 'reference' ? '.' : ', or use Contains.'}</p>}
    </div>
  )
}

/** The filter button on a column heading: sort, an Excel-style value list, and an Apply that narrows the list. */
export function HeaderFilter({
  f, criteria, onApply, tableKey, q = '', sort,
}: {
  f: FieldDef
  criteria: FilterCriteria
  onApply: (next: FilterCriteria, labels?: Record<string, string>) => void
  tableKey: string
  q?: string
  /** Present when the column can be sorted: the current direction (if it is the sorted column) and a way to change it. */
  sort?: { direction: 'asc' | 'desc' | null; onSort: (direction: 'asc' | 'desc') => void }
}) {
  const kind = filterKind(f)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'values' | 'contains'>('values')
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [bool, setBool] = useState('')
  const [lo, setLo] = useState('')
  const [hi, setHi] = useState('')
  const seen = useRef<Record<string, string>>({})
  const remember = (m: Record<string, string>) => { Object.assign(seen.current, m) }
  const view = useRef<{ shown: string[]; searched: boolean }>({ shown: [], searched: false })
  const onView = (shown: string[], searched: boolean) => { view.current = { shown, searched } }
  if (!kind) return null
  const listed = kind === 'choices' || kind === 'tags' || kind === 'reference' || (kind === 'text' && f.type !== 'long_text')
  const active = !!describe(f, criteria)
  const load = () => {
    setText(criteria.contains[f.key] ?? '')
    setMode(criteria.contains[f.key] || f.type === 'long_text' ? 'contains' : 'values')
    const had = (criteria.anyof[f.key] ?? '').split(',').filter(Boolean)
    setPicked(had.length ? new Set(had) : null)
    setBool(criteria.filters[f.key] ?? '')
    const [a = '', b = ''] = (criteria.ranges[f.key] ?? '').split('..')
    setLo(a)
    setHi(b)
  }
  const apply = (clear: boolean) => {
    const next: FilterCriteria = { filters: { ...criteria.filters }, ranges: { ...criteria.ranges }, contains: { ...criteria.contains }, anyof: { ...criteria.anyof } }
    if (kind === 'text' && f.type === 'long_text') next.contains[f.key] = clear ? '' : text.trim()
    else if (listed) {
      if (clear || (mode === 'contains' && kind === 'text')) next.anyof[f.key] = ''
      if (clear || mode === 'values') next.contains[f.key] = ''
      if (!clear && mode === 'contains') next.contains[f.key] = text.trim()
      if (!clear && mode === 'values') next.anyof[f.key] = picked ? [...picked].join(',') : view.current.searched ? view.current.shown.join(',') : ''
    } else if (kind === 'boolean') next.filters[f.key] = clear ? '' : bool
    else next.ranges[f.key] = clear || (!lo && !hi) ? '' : `${lo}..${hi}`
    onApply(next, seen.current)
    setOpen(false)
  }
  const numeric = kind === 'number'
  const words = SORT_WORDS[numeric ? 'number' : kind === 'date' ? 'date' : 'text']
  const emptyPick = mode === 'values' && listed && picked !== null && picked.size === 0
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        if (o) load()
        setOpen(o)
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Filter ${f.label}`}
          className={cn('rounded p-0.5 hover:bg-soft hover:text-ink', active ? 'text-accent-ink' : 'text-muted')}
          data-testid={`filter-${f.key}`}
        >
          <Filter className={cn('size-3', active && 'fill-current')} aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-72 rounded-lg border border-line bg-surface p-3 shadow-pop" aria-label={`Filter ${f.label}`}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!emptyPick) apply(false)
            }}
          >
            <p className="text-sm font-semibold text-ink">{f.label}</p>
            {sort && (
              <div className="flex flex-col gap-0.5 border-b border-line pb-2">
                {(['asc', 'desc'] as const).map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={sort.direction === d}
                    className={cn('flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-soft', sort.direction === d ? 'bg-accent-soft font-semibold text-accent-ink' : 'text-body')}
                    onClick={() => {
                      sort.onSort(d)
                      setOpen(false)
                    }}
                  >
                    {d === 'asc' ? <ArrowUpAZ className="size-4" aria-hidden /> : <ArrowDownAZ className="size-4" aria-hidden />}
                    {words[i]}
                  </button>
                ))}
              </div>
            )}
            {listed && f.type !== 'long_text' && kind === 'text' && (
              <div role="tablist" aria-label="How to filter" className="flex gap-1 rounded-md bg-soft p-0.5 text-xs font-semibold">
                {(['values', 'contains'] as const).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} className={cn('flex-1 rounded px-2 py-1', mode === m ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink')} onClick={() => setMode(m)}>
                    {m === 'values' ? 'Pick values' : 'Contains'}
                  </button>
                ))}
              </div>
            )}
            {listed && mode === 'values' && <ValueList f={f} tableKey={tableKey} q={q} criteria={criteria} picked={picked} onPick={setPicked} onLabels={remember} onView={onView} />}
            {(kind === 'text' && (mode === 'contains' || f.type === 'long_text')) && <Input aria-label={`${f.label} contains`} placeholder="Contains…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />}
            {kind === 'boolean' && (
              <fieldset className="flex gap-3">
                <legend className="sr-only">{f.label}</legend>
                {[['', 'Any'], ['true', 'Yes'], ['false', 'No']].map(([v, l]) => (
                  <label key={v} className="flex items-center gap-1 text-sm text-body">
                    <input type="radio" name={`bool-${f.key}`} checked={bool === v} onChange={() => setBool(v!)} /> {l}
                  </label>
                ))}
              </fieldset>
            )}
            {(numeric || kind === 'date') && (
              <div className="flex items-center gap-2">
                <Input aria-label={`${f.label} from`} type={numeric ? 'number' : 'date'} placeholder="From" value={lo} onChange={(e) => setLo(e.target.value)} />
                <span className="text-xs text-muted">to</span>
                <Input aria-label={`${f.label} to`} type={numeric ? 'number' : 'date'} placeholder="To" value={hi} onChange={(e) => setHi(e.target.value)} />
              </div>
            )}
            {numeric && f.type === 'months' && <p className="text-xs text-muted">In months.</p>}
            {emptyPick && <p className="text-xs text-muted" role="status">Tick at least one value, or use Clear to show everything.</p>}
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => apply(true)} disabled={!active}>Clear</Button>
              <span className="flex gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="sm" disabled={emptyPick}>Apply</Button>
              </span>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
