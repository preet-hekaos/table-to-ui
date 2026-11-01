import * as RadixDialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useDebounced } from '@/lib/useDebounced'
import { search } from '@/api/endpoints'
import { ScrollArea, cn } from '@/design-system'

type Hit = { key: string; label: string; hint: string; go: () => void }


/** Ctrl K or Cmd K: jump to any screen or record by name (S24). */
export function CommandBar() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const dq = useDebounced(q, 120)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const res = useQuery({ queryKey: ['command-bar', dq], queryFn: () => search.bar(dq), enabled: open && dq.trim().length >= 2, placeholderData: (p) => p })
  const close = () => {
    setOpen(false)
    setQ('')
    setActive(0)
  }
  const hits: Hit[] = [
    ...(res.data?.screens ?? []).map((s) => ({ key: `s-${s.screen}`, label: s.label, hint: 'Screen', go: () => void navigate({ to: '/s/$screen', params: { screen: s.screen }, search: {} }) })),
    ...(res.data?.records ?? []).map((r) => ({ key: `r-${r.id}`, label: r.label ?? '(no name)', hint: r.table_label, go: () => void navigate({ to: '/records/$table/$id', params: { table: r.table, id: r.id } }) })),
  ]
  const choose = (h: Hit | undefined) => {
    if (!h) return
    close()
    h.go()
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative hidden h-9 max-w-md flex-1 items-center gap-2 rounded-md border border-line bg-canvas pr-3 pl-2.5 text-left text-sm text-muted hover:border-accent sm:flex"
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search className="size-4" aria-hidden /> Search or jump to…
        <kbd className="ml-auto rounded border border-line bg-surface px-1.5 text-[11px] text-muted">Ctrl K</kbd>
      </button>
      <button type="button" onClick={() => setOpen(true)} aria-label="Search" className="rounded-md p-2 text-muted hover:bg-soft sm:hidden">
        <Search className="size-4" aria-hidden />
      </button>
      <RadixDialog.Root open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <RadixDialog.Portal>
          <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
          <RadixDialog.Content className="fixed top-[12vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg bg-surface shadow-pop" aria-describedby={undefined}>
            <RadixDialog.Title className="sr-only">Search or jump to</RadixDialog.Title>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-4 text-muted" aria-hidden />
              <input
                autoFocus
                role="combobox"
                aria-expanded={hits.length > 0}
                aria-controls="command-results"
                aria-activedescendant={hits[active] ? `cmd-${hits[active].key}` : undefined}
                aria-label="Search records and screens"
                className="h-12 flex-1 bg-transparent text-sm text-ink outline-none"
                placeholder="Type a name: a person, a company, a screen…"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value)
                  setActive(0)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault()
                    setActive((a) => Math.min(a + 1, hits.length - 1))
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault()
                    setActive((a) => Math.max(a - 1, 0))
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    choose(hits[active])
                  }
                }}
              />
            </div>
            <ScrollArea as="ul" id="command-results" role="listbox" aria-label="Results" className="max-h-80 p-1">
              {dq.trim().length < 2 && <li className="px-3 py-6 text-center text-sm text-muted">Type at least two letters.</li>}
              {dq.trim().length >= 2 && hits.length === 0 && !res.isFetching && <li className="px-3 py-6 text-center text-sm text-muted">Nothing found.</li>}
              {hits.map((h, i) => (
                <li
                  key={h.key}
                  id={`cmd-${h.key}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(h)}
                  className={cn('flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm', i === active ? 'bg-accent-soft text-accent-ink' : 'text-ink')}
                >
                  <span className="truncate font-medium">{h.label}</span>
                  <span className={cn('ml-3 shrink-0 text-xs', i === active ? 'text-accent-ink' : 'text-muted')}>{h.hint}</span>
                </li>
              ))}
            </ScrollArea>
          </RadixDialog.Content>
        </RadixDialog.Portal>
      </RadixDialog.Root>
    </>
  )
}
