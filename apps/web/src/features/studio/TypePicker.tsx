import * as Popover from '@radix-ui/react-popover'
import { ChevronDown, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Button, cn } from '@/design-system'
import { coreTypes, type TypeChoice } from './typeCatalog'

/** The little symbol before a type name. Drawn with CSS so it never counts as the button's visible text. */
export const Tile = ({ text, active }: { text: string; active?: boolean }) => (
  <span
    aria-hidden
    data-tile={text}
    className={cn("inline-flex h-6 min-w-8 items-center justify-center rounded-md px-1.5 text-[11px] font-semibold before:content-[attr(data-tile)]", active ? 'bg-accent-soft text-accent-ink' : 'bg-soft text-accent-ink')}
  />
)

const SAVED_AS = { upper: 'Capital letters', lower: 'Lower case' } as const

/**
 * The Type picker of board 2: a search box, groups ranked business-first, and a "What it sets for you" pane.
 * `blocked` says why a choice cannot be used on this field; the pane then offers to add a new field instead.
 */
export function TypePicker({
  choices,
  current,
  blocked,
  onUse,
  onAddNew,
  label,
  trigger,
  areaLabel,
}: {
  choices: TypeChoice[]
  current?: TypeChoice
  blocked?: (c: TypeChoice) => string | null
  onUse: (c: TypeChoice) => void
  onAddNew?: () => void
  label: string
  trigger?: ReactNode
  areaLabel: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [showCore, setShowCore] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(current?.id)
  const id = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const matches = (c: TypeChoice) => {
    const t = q.trim().toLowerCase()
    return !t || c.name.toLowerCase().includes(t) || c.core.includes(t) || c.description.toLowerCase().includes(t)
  }
  const coreChoices: TypeChoice[] = useMemo(
    () => coreTypes.map((t) => choices.find((c) => c.id === `core:${t}`)!).filter(Boolean),
    [choices],
  )
  const groups = useMemo(() => {
    const g = [
      { key: 'common', title: 'Commonly used', hint: '', items: choices.filter((c) => c.group === 'common' && matches(c)) },
      { key: 'area', title: areaLabel, hint: 'for this workspace', items: choices.filter((c) => c.group === 'area' && matches(c)) },
      { key: 'other', title: 'All others', hint: '', items: choices.filter((c) => c.group === 'other' && matches(c)) },
    ]
    return g.filter((x) => x.items.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choices, q, areaLabel])
  const shownCore = showCore || q.trim() ? coreChoices.filter(matches) : []
  const flat = [...groups.flatMap((g) => g.items), ...shownCore.filter((c) => !groups.some((g) => g.items.includes(c)))]
  const flatKey = (c: TypeChoice, scope: string) => `${scope}:${c.id}`
  const active = choices.find((c) => c.id === activeId) ?? flat[0]
  const reason = active && blocked ? blocked(active) : null

  useEffect(() => {
    if (!active) return
    listRef.current?.querySelector<HTMLElement>(`[data-choice="${CSS.escape(active.id)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const commit = () => {
    if (!active || reason) return
    onUse(active)
    setOpen(false)
  }
  const move = (d: number) => {
    if (!flat.length) return
    const i = Math.max(0, flat.findIndex((c) => c.id === active?.id))
    setActiveId(flat[(i + d + flat.length) % flat.length]!.id)
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); commit() }
  }

  const row = (c: TypeChoice, scope: string) => {
    const why = blocked?.(c) ?? null
    const selected = active?.id === c.id
    return (
      <div
        key={flatKey(c, scope)}
        id={`${id}-${c.id}`}
        data-choice={c.id}
        role="option"
        aria-selected={selected}
        aria-disabled={why ? true : undefined}
        onClick={() => setActiveId(c.id)}
        onDoubleClick={() => { if (!why) { setActiveId(c.id); onUse(c); setOpen(false) } }}
        className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg border px-2 py-1.5 text-sm', selected ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-soft', why && 'opacity-50')}
      >
        <Tile text={c.tile} active={selected} />
        <span className="flex-1 text-ink">{c.name}</span>
        <span className="font-mono text-[11px] text-muted">{c.core}</span>
      </div>
    )
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          setActiveId(current?.id)
          setQ('')
          setShowCore(false)
        }
      }}
    >
      <Popover.Trigger asChild>
        {trigger ?? (
          <button type="button" aria-label={label} className="flex items-center gap-2 rounded-md border border-transparent px-1 py-0.5 text-left text-sm text-ink hover:border-line hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
            {current && <Tile text={current.tile} />}
            <span>{current?.name ?? 'Choose a type'}</span>
            <ChevronDown className="size-3.5 text-muted" aria-hidden />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} collisionPadding={16} aria-label="Type picker" className="z-50 flex w-[42rem] max-w-[95vw] overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className="flex w-1/2 min-w-0 flex-col border-r border-line p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted" aria-hidden />
              <input
                autoFocus
                role="combobox"
                aria-expanded
                aria-controls={`${id}-list`}
                aria-activedescendant={active ? `${id}-${active.id}` : undefined}
                aria-label="Search types"
                placeholder="Search types, for example salary, mobile, PAN"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-2 text-sm"
              />
            </div>
            <div ref={listRef} id={`${id}-list`} role="listbox" aria-label="Types" className="mt-2 max-h-80 overflow-y-auto pr-1">
              {groups.map((g) => (
                <div key={g.key} role="group" aria-label={g.title} className="mb-2">
                  <p className="px-1 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {g.title} {g.hint && <span className="ml-1 font-normal normal-case">{g.hint}</span>}
                  </p>
                  {g.items.map((c) => row(c, g.key))}
                </div>
              ))}
              {!flat.length && <p className="px-2 py-4 text-sm text-muted">No type matches “{q}”.</p>}
              <div role="group" aria-label="Core types" className="mb-1 rounded-lg border border-dashed border-line p-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Core types <span className="ml-1 font-normal normal-case">low level</span></p>
                {showCore || q.trim() ? (
                  <div className="mt-1">{shownCore.map((c) => row(c, 'core'))}</div>
                ) : (
                  <p className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted">
                    <span>{coreTypes.slice(0, 4).join(' · ')} · +{coreTypes.length - 4}</span>
                    <button type="button" className="font-sans text-xs text-accent-ink hover:underline" onClick={() => setShowCore(true)}>Show all {coreTypes.length} ▸</button>
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex w-1/2 min-w-0 flex-col p-4">
            {active ? (
              <>
                <div className="flex items-start gap-3">
                  <Tile text={active.tile} active />
                  <div>
                    <p className="font-semibold text-ink">{active.name}</p>
                    <p className="text-xs text-muted">{active.description}</p>
                  </div>
                </div>
                <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">What it sets for you</p>
                <dl className="mt-1 grid grid-cols-[6.5rem_1fr] gap-y-1.5 text-sm">
                  <dt className="text-muted">Core type</dt><dd><code className="rounded bg-soft px-1.5 py-0.5 font-mono text-xs">{active.core}</code></dd>
                  <dt className="text-muted">Length</dt><dd className="font-mono">{active.preset?.max_length ?? '–'}</dd>
                  {(active.preset?.min != null || active.preset?.max != null) && (<><dt className="text-muted">Range</dt><dd className="font-mono">{active.preset?.min} to {active.preset?.max}</dd></>)}
                  <dt className="text-muted">Saved as</dt><dd>{active.preset?.save_as ? SAVED_AS[active.preset.save_as] : 'As typed'}</dd>
                  {active.preset && (<><dt className="text-muted">Example</dt><dd className="font-mono">{active.preset.example}</dd></>)}
                  <dt className="text-muted">If blank</dt><dd className="text-muted">Nothing</dd>
                </dl>
                {reason ? (
                  <div role="status" className="mt-4 rounded-lg border border-warn bg-warn-soft p-3 text-xs text-warn-ink">
                    <p>Cannot use this type here: {reason}.</p>
                    {onAddNew && (
                      <Button size="sm" variant="secondary" className="mt-2" onClick={() => { setOpen(false); onAddNew() }}>Add a new field</Button>
                    )}
                  </div>
                ) : (
                  <p className="mt-4 rounded-lg border border-line bg-soft/60 p-3 text-xs text-body">
                    A type is a starting point. After you pick it, change the length or the rules in the row. The stored data uses the core type, so nothing in the database changes.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">Pick a type on the left to see what it sets.</p>
            )}
            <div className="mt-auto flex justify-end gap-2 pt-4">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={commit} disabled={!active || !!reason}>Use {active?.name ?? ''}</Button>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

