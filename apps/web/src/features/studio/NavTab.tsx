import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import { admin, studio, type DraftNav } from '@/api/endpoints'
import { Badge, Button, Card, ErrorState, Input, LoadingState, Select, StageBadge, cn, stageStripe, useToast } from '@/design-system'
import { useStages } from './useStages'

type Item = Omit<DraftNav, 'version' | 'source'>
const strip = (n: DraftNav): Item => ({ key: n.key, label: n.label, screen: n.screen, icon: n.icon, section: n.section, order: n.order, roles: n.roles })

/** Screen 2.6: the app menu, its order and sections, and which roles see each entry. Saved to Draft. */
export function NavTab({ canEdit }: { canEdit: boolean }) {
  const nav = useQuery({ queryKey: ['studio-nav'], queryFn: studio.navigation, retry: false })
  if (nav.isError) return <ErrorState requestId={(nav.error as ApiError).requestId} onRetry={() => void nav.refetch()} />
  if (!nav.data) return <LoadingState label="Loading the menu" />
  return <NavEditor key={JSON.stringify(nav.data)} saved={nav.data.map(strip)} canEdit={canEdit} />
}

function NavEditor({ saved, canEdit }: { saved: Item[]; canEdit: boolean }) {
  const stages = useStages()
  const qc = useQueryClient()
  const toast = useToast()
  const screens = useQuery({ queryKey: ['studio-screens'], queryFn: studio.screens, retry: false })
  const roles = useQuery({ queryKey: ['roles'], queryFn: admin.roles, retry: false })
  const [items, setItems] = useState<Item[]>(saved)
  const save = useMutation({
    mutationFn: () => studio.saveNavigation(items.map((n, i) => ({ ...n, order: (i + 1) * 10 }))),
    onSuccess: async () => {
      toast({ title: 'Menu saved in Draft', description: 'Publish to show it to everyone.', tone: 'ok' })
      await Promise.all([qc.invalidateQueries({ queryKey: ['studio-nav'] }), qc.invalidateQueries({ queryKey: ['studio-status'] })])
    },
    onError: (e) => toast({ title: 'Could not save the menu', description: (e as Error).message, tone: 'bad' }),
  })
  if (screens.isLoading) return <LoadingState label="Loading the menu" />
  const set = (i: number, patch: Partial<Item>) => setItems(items.map((n, j) => (j === i ? { ...n, ...patch } : n)))
  const move = (i: number, d: -1 | 1) => {
    const next = [...items]
    const [x] = next.splice(i, 1)
    if (x) next.splice(i + d, 0, x)
    setItems(next)
  }
  const used = new Set(items.map((n) => n.screen))
  const free = (screens.data ?? []).filter((s) => !used.has(s.key))
  const roleList = roles.data ?? []
  const dirty = JSON.stringify(items) !== JSON.stringify(saved)
  const name = (k: string) => (k === 'main' ? 'Main menu' : k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '))
  const keys = ['main', ...new Set(items.map((n) => n.section).filter((k) => k !== 'main' && k !== 'more')), 'more']
  const sections: [string, string][] = keys.map((k) => [k, name(k)])
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Menu changes stay in Draft until you publish. Each person only sees entries for tables their role can read. The name here is the sidebar entry; a page’s heading is its screen Title (Tables › Screens).</p>
      {sections.map(([section, title]) => (
        <Card key={section} className="p-0">
          <h2 className="border-b border-line p-3 text-sm font-bold text-ink">{title}</h2>
          <ul className="divide-y divide-line" aria-label={title}>
            {items.map((n, i) =>
              n.section !== section ? null : (
                <li key={n.key} className={cn('flex flex-wrap items-center gap-2 p-3', stageStripe(stages.of('navs', n.key)))} data-stage={stages.of('navs', n.key)} data-testid={`nav-item-${n.key}`}>
                  {stages.of('navs', n.key) && <StageBadge stage={stages.of('navs', n.key)!} isNew={stages.isNew('navs', n.key)} />}
                  <Input
                    aria-label={`Label for ${n.label || n.key}`}
                    className="w-44"
                    value={n.label}
                    disabled={!canEdit}
                    onChange={(e) => set(i, { label: e.target.value })}
                  />
                  <Select aria-label={`Screen for ${n.label}`} className="w-44" value={n.screen} disabled={!canEdit} onChange={(e) => set(i, { screen: e.target.value })}>
                    {(screens.data ?? []).map((s) => (
                      <option key={s.key} value={s.key}>
                        {s.title}
                      </option>
                    ))}
                  </Select>
                  <Select aria-label={`Section for ${n.label}`} className="w-28" value={n.section} disabled={!canEdit} onChange={(e) => set(i, { section: e.target.value })}>
                    {keys.map((k) => <option key={k} value={k}>{k === 'main' ? 'Main' : name(k)}</option>)}
                  </Select>
                  <details className="relative">
                    <summary className="cursor-pointer rounded-md border border-line px-3 py-1.5 text-sm text-body">
                      {n.roles.length ? `${n.roles.length} role${n.roles.length > 1 ? 's' : ''}` : 'Everyone'}
                    </summary>
                    <fieldset className="absolute z-10 mt-1 flex w-56 flex-col gap-1 rounded-md border border-line bg-surface p-3 shadow-pop">
                      <legend className="sr-only">Who sees {n.label}</legend>
                      {roleList.map((r) => (
                        <label key={r.key} className="flex items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            disabled={!canEdit}
                            checked={n.roles.includes(r.key)}
                            onChange={(e) => set(i, { roles: e.target.checked ? [...n.roles, r.key] : n.roles.filter((x) => x !== r.key) })}
                          />
                          {r.name}
                        </label>
                      ))}
                      <p className="text-xs text-muted">None ticked means everyone.</p>
                    </fieldset>
                  </details>
                  {canEdit && (
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" aria-label={`Move ${n.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <ArrowUp className="size-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Move ${n.label} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)}>
                        <ArrowDown className="size-4" aria-hidden />
                      </Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${n.label}`} onClick={() => setItems(items.filter((_, j) => j !== i))}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </span>
                  )}
                </li>
              ),
            )}
          </ul>
        </Card>
      ))}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {free.length > 0 && (
            <Select
              aria-label="Add a screen to the menu"
              className="w-60"
              value=""
              onChange={(e) => {
                const s = free.find((x) => x.key === e.target.value)
                if (s) setItems([...items, { key: `nav_${s.key}`, label: s.title, screen: s.key, icon: 'list', section: 'more', order: 0, roles: [] }])
              }}
            >
              <option value="">Add a screen to the menu…</option>
              {free.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.title}
                </option>
              ))}
            </Select>
          )}
          {dirty && <Badge tone="warn">Unsaved</Badge>}
          <Button variant="primary" className="ml-auto" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
            Save menu
          </Button>
        </div>
      )}
    </div>
  )
}
