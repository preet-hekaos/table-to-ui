import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { Filter } from 'lucide-react'
import { useState } from 'react'
import { app } from '@/api/endpoints'
import type { FieldDef } from '@/api/types'
import { Button, Input, cn } from '@/design-system'

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
  if (kind === 'text') return c.contains[f.key] ? `${f.label} contains “${c.contains[f.key]}”` : ''
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

function Choices({ f, picked, onChange, tableKey }: { f: FieldDef; picked: string[]; onChange: (v: string[]) => void; tableKey: string }) {
  const kind = filterKind(f)
  const opts = useQuery({
    queryKey: ['filter-options', tableKey, f.key, f.ref_table, f.type],
    queryFn: async () => {
      if (f.type === 'tags') {
        const r = await app.facets(tableKey, { fields: [f.key] })
        return (r.facets[f.key]?.values ?? []).map((v) => ({ value: v.value, label: v.label }))
      }
      const r = await app.options(f.ref_table!)
      const def = await app.table(f.ref_table!)
      const title = def.table.title_field
      return r.items.map((x) => ({ value: x.id, label: String(x.data[title] ?? x.id) }))
    },
    enabled: kind === 'tags' || kind === 'reference',
  })
  const list = kind === 'choices' ? f.options.map((o) => ({ value: o, label: o })) : (opts.data ?? [])
  if (kind !== 'choices' && opts.isLoading) return <p className="text-xs text-muted">Loading choices…</p>
  if (list.length === 0) return <p className="text-xs text-muted">No choices yet.</p>
  return (
    <fieldset className="flex max-h-56 flex-col gap-1 overflow-y-auto">
      <legend className="sr-only">Choices for {f.label}</legend>
      {list.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-sm text-body">
          <input type="checkbox" checked={picked.includes(o.value)} onChange={(e) => onChange(e.target.checked ? [...picked, o.value] : picked.filter((x) => x !== o.value))} />
          {o.label}
        </label>
      ))}
    </fieldset>
  )
}

/** The filter button on a column heading. It edits a draft of the answer and applies it on request. */
export function HeaderFilter({ f, criteria, onApply, tableKey }: { f: FieldDef; criteria: FilterCriteria; onApply: (next: FilterCriteria) => void; tableKey: string }) {
  const kind = filterKind(f)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [bool, setBool] = useState('')
  const [lo, setLo] = useState('')
  const [hi, setHi] = useState('')
  if (!kind) return null
  const active = !!describe(f, criteria)
  const load = () => {
    setText(criteria.contains[f.key] ?? '')
    setPicked((criteria.anyof[f.key] ?? '').split(',').filter(Boolean))
    setBool(criteria.filters[f.key] ?? '')
    const [a = '', b = ''] = (criteria.ranges[f.key] ?? '').split('..')
    setLo(a)
    setHi(b)
  }
  const apply = (clear: boolean) => {
    const next: FilterCriteria = { filters: { ...criteria.filters }, ranges: { ...criteria.ranges }, contains: { ...criteria.contains }, anyof: { ...criteria.anyof } }
    if (kind === 'text') next.contains[f.key] = clear ? '' : text.trim()
    else if (kind === 'choices' || kind === 'tags' || kind === 'reference') next.anyof[f.key] = clear ? '' : picked.join(',')
    else if (kind === 'boolean') next.filters[f.key] = clear ? '' : bool
    else next.ranges[f.key] = clear || (!lo && !hi) ? '' : `${lo}..${hi}`
    onApply(next)
    setOpen(false)
  }
  const numeric = kind === 'number'
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
        <Popover.Content align="start" sideOffset={6} className="z-50 w-64 rounded-lg border border-line bg-surface p-3 shadow-pop" aria-label={`Filter ${f.label}`}>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              apply(false)
            }}
          >
            <p className="text-sm font-semibold text-ink">{f.label}</p>
            {kind === 'text' && <Input aria-label={`${f.label} contains`} placeholder="Contains…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />}
            {(kind === 'choices' || kind === 'tags' || kind === 'reference') && <Choices f={f} picked={picked} onChange={setPicked} tableKey={tableKey} />}
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
            <div className="flex justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => apply(true)} disabled={!active}>Clear</Button>
              <Button type="submit" variant="primary" size="sm">Apply</Button>
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
