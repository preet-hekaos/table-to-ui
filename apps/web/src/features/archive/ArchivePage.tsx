import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, X } from 'lucide-react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { archive, type ArchiveItem, type ArchiveKind, type ArchiveSetting } from '@/api/endpoints'
import { Button, Dialog, EmptyState, Input, LoadingState, Select, SideContent, Switch, Table, Td, Th, cn, useToast } from '@/design-system'
import { fmtDate } from './ArchiveDialog'

const KINDS: { key: ArchiveKind | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'table', label: 'Tables' },
  { key: 'field', label: 'Fields' },
  { key: 'link', label: 'Links' },
  { key: 'measure', label: 'Measures' },
  { key: 'automation', label: 'Automations' },
  { key: 'record', label: 'Records' },
]
const KIND_NAME: Record<ArchiveKind, string> = { table: 'Table', field: 'Field', link: 'Link', measure: 'Measure', automation: 'Automation', record: 'Record' }
const DAYS = [7, 14, 30, 60, 90, 180, 365]

const left = (i: ArchiveItem) =>
  i.needs_publish ? 'Publish first, then it can be deleted' : i.delete_after === null ? 'Kept until you delete it' : i.days_left === 0 ? 'today' : `in ${i.days_left} ${i.days_left === 1 ? 'day' : 'days'} · ${fmtDate(i.delete_after)}`

/** Settings › Archive: everything an admin took out, with Restore, Delete forever and the auto-delete clock. */
export function ArchivePage() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['archive'], queryFn: archive.list })
  const [kind, setKind] = useState<ArchiveKind | 'all'>('all')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [clock, setClock] = useState(false)
  const [forever, setForever] = useState(false)
  const items = q.data?.items ?? []
  const shown = useMemo(
    () => items.filter((i) => (kind === 'all' || i.kind === kind) && `${i.label} ${i.detail}`.toLowerCase().includes(search.trim().toLowerCase())),
    [items, kind, search],
  )
  const counts = (k: ArchiveKind | 'all') => (k === 'all' ? items.length : items.filter((i) => i.kind === k).length)
  const chosen = shown.filter((i) => picked.has(i.id))
  const allOn = shown.length > 0 && chosen.length === shown.length
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const refresh = () => qc.invalidateQueries()
  const restore = useMutation({
    mutationFn: (ids: string[]) => archive.restore(ids),
    onSuccess: async (r) => {
      await refresh()
      setPicked(new Set())
      if (r.failed.length) toast({ title: `${r.restored.length} restored, ${r.failed.length} could not be`, description: r.failed[0]!.message, tone: 'bad' })
      else toast({ title: r.restored.length === 1 ? 'Restored' : `${r.restored.length} restored`, tone: 'ok' })
    },
    onError: (e) => toast({ title: 'Could not restore', description: (e as Error).message, tone: 'bad' }),
  })
  if (q.isLoading) return <LoadingState label="Loading the archive" />
  if (q.isError || !q.data) return <p role="alert" className="text-sm text-bad-ink">The archive could not be loaded.</p>
  const s = q.data.setting
  return (
    <div className="flex flex-col gap-4" data-testid="archive-page">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted">Archived things are hidden for everyone. Restore them, or delete them for good. Only admins see this page.</p>
        <Button variant="secondary" onClick={() => setClock(true)} data-testid="open-auto-delete">
          Auto-delete: {s.auto_delete ? `${s.days} days` : 'off'}
        </Button>
      </div>
      <div role="tablist" aria-label="Kinds" className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line">
        {KINDS.map((k) => (
          <button
            key={k.key}
            role="tab"
            type="button"
            aria-selected={kind === k.key}
            onClick={() => { setKind(k.key); setPicked(new Set()) }}
            className={cn('-mb-px border-b-2 py-2 text-sm', kind === k.key ? 'border-accent font-semibold text-accent-ink' : 'border-transparent text-muted hover:text-ink')}
          >
            {k.label} ({counts(k.key)})
          </button>
        ))}
      </div>
      <Input aria-label="Search archived items" placeholder="Search archived items" className="max-w-sm" value={search} onChange={(e) => setSearch(e.target.value)} />
      {chosen.length > 0 && (
        <div role="region" aria-label="Selected items" data-testid="archive-bar" className="flex flex-wrap items-center gap-3 rounded-lg bg-ink px-4 py-2.5 text-sm text-white">
          <b>{chosen.length} selected</b>
          <span className="flex-1" />
          <Button variant="secondary" size="sm" loading={restore.isPending} onClick={() => restore.mutate(chosen.map((i) => i.id))}>Restore</Button>
          <Button variant="danger" size="sm" onClick={() => setForever(true)}>Delete forever…</Button>
        </div>
      )}
      {shown.length === 0 ? (
        <EmptyState title={items.length === 0 ? 'The archive is empty' : 'Nothing matches'}>
          {items.length === 0 ? 'Things you archive in Studio or in a list wait here until you restore or delete them.' : 'Try another kind or clear the search.'}
        </EmptyState>
      ) : (
        <Table aria-label="Archived items">
          <thead>
            <tr>
              <Th className="w-10"><input type="checkbox" aria-label="Select all" checked={allOn} onChange={() => setPicked(allOn ? new Set() : new Set(shown.map((i) => i.id)))} className="size-4" /></Th>
              <Th>Name</Th><Th>Kind</Th><Th>Archived</Th><Th>Deletes on</Th><Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => (
              <tr key={i.id} data-testid="archive-row" className={cn(picked.has(i.id) && 'bg-accent-soft/40')}>
                <Td><input type="checkbox" aria-label={`Select ${i.label}`} checked={picked.has(i.id)} onChange={() => toggle(i.id)} className="size-4" /></Td>
                <Td><div className="font-semibold text-ink">{i.label}</div><div className="text-xs text-muted">{i.detail}</div></Td>
                <Td>{KIND_NAME[i.kind]}</Td>
                <Td>{fmtDate(i.archived_at)}{i.archived_by ? ` · ${i.archived_by}` : ''}</Td>
                <Td>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', i.days_left !== null && i.days_left <= s.warn_days ? 'bg-bad-soft text-bad-ink' : 'text-body')}>{left(i)}</span>
                </Td>
                <Td className="text-right"><Button size="sm" variant="secondary" aria-label={`Restore ${i.label}`} onClick={() => restore.mutate([i.id])}>Restore</Button></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {clock && <AutoDelete setting={s} onClose={() => setClock(false)} />}
      {forever && <DeleteForever items={chosen} onClose={() => setForever(false)} onDone={() => { setForever(false); setPicked(new Set()) }} />}
    </div>
  )
}

function DeleteForever({ items, onClose, onDone }: { items: ArchiveItem[]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const phrase = items.length === 1 ? items[0]!.label : `delete ${items.length} items`
  const go = useMutation({
    mutationFn: () => archive.deleteForever(items.map((i) => i.id)),
    onSuccess: async (r) => { await qc.invalidateQueries(); toast({ title: `${r.deleted} deleted for good`, tone: 'ok' }); onDone() },
    onError: (e) => toast({ title: 'Could not delete', description: (e as Error).message, tone: 'bad' }),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-ink/40" />
        <RadixDialog.Content data-testid="delete-forever" className="fixed top-1/2 left-1/2 z-[70] w-[min(35rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-pop focus:outline-none">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-bad-soft text-bad-ink"><AlertTriangle className="size-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <RadixDialog.Title className="text-lg font-bold text-ink">Delete {items.length === 1 ? 'this item' : `${items.length} items`} forever?</RadixDialog.Title>
              <RadixDialog.Description className="mt-1 text-sm text-body">This cannot be undone. Not even an admin can bring {items.length === 1 ? 'it' : 'them'} back.</RadixDialog.Description>
            </div>
            <RadixDialog.Close aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-soft"><X className="size-4" aria-hidden /></RadixDialog.Close>
          </div>
          <ul className="my-4 max-h-40 overflow-y-auto rounded-lg bg-soft px-3 py-2 text-sm">
            {items.map((i) => <li key={i.id}><b>{i.label}</b> <span className="text-muted">· {i.detail}</span></li>)}
          </ul>
          <label htmlFor="forever-confirm" className="mb-1.5 block text-sm text-ink">
            Please type <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[13px]">{phrase}</code> to confirm.
          </label>
          <Input id="forever-confirm" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <Button variant="danger" className="mt-4 h-11 w-full" disabled={typed !== phrase} loading={go.isPending} onClick={() => go.mutate()}>
            I understand, delete forever
          </Button>
          <div className="mt-2 text-center"><Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button></div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </Dialog>
  )
}

const KIND_ROWS: { key: ArchiveKind; label: string }[] = [
  { key: 'table', label: 'Tables' },
  { key: 'field', label: 'Fields' },
  { key: 'link', label: 'Links' },
  { key: 'measure', label: 'Measures' },
  { key: 'automation', label: 'Automations' },
  { key: 'record', label: 'Records' },
]

function AutoDelete({ setting, onClose }: { setting: ArchiveSetting; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [on, setOn] = useState(setting.auto_delete)
  const [days, setDays] = useState(setting.days)
  const [per, setPer] = useState<Record<string, number>>(setting.per_kind)
  const [warn, setWarn] = useState(setting.warn_days)
  const [ask, setAsk] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (confirm: boolean) => archive.save({ auto_delete: on, days, per_kind: per, warn_days: warn, confirm }),
    onSuccess: async () => { await qc.invalidateQueries(); toast({ title: 'Auto-delete saved', tone: 'ok' }); onClose() },
    onError: (e) => {
      if (e instanceof ApiError && e.errors[0]?.code === 'confirm') setAsk(e.errors[0].message)
      else toast({ title: 'Could not save', description: (e as Error).message, tone: 'bad' })
    },
  })
  const setKind = (k: string, v: string) => setPer((p) => { const n = { ...p }; if (v === 'same') delete n[k]; else n[k] = Number(v); return n })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SideContent
        testId="auto-delete-panel"
        title="Auto-delete"
        description="Archived things are deleted for good after this many days. The clock starts when they are archived."
        footer={
          <>
            <span className="flex-1" />
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={save.isPending} onClick={() => { setAsk(null); save.mutate(false) }}>Save</Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <Switch label="Delete archived things automatically" checked={on} onCheckedChange={setOn} />
            <span className="text-sm font-semibold text-ink">Delete archived things automatically</span>
          </div>
          <div className={cn('flex flex-wrap items-center gap-2 text-sm', !on && 'opacity-50')}>
            After
            <Select aria-label="Days before deleting" disabled={!on} className="w-24" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
            days
          </div>
          {!on && <p className="-mt-3 text-xs text-muted">Off means nothing is ever deleted by itself. The archive just keeps growing.</p>}
          <div className={cn(!on && 'pointer-events-none opacity-50')}>
            <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Different time for some kinds</p>
            {KIND_ROWS.map((k) => (
              <div key={k.key} className="flex items-center justify-between gap-3 border-b border-line py-2 text-sm">
                <span>{k.label}</span>
                <Select aria-label={`${k.label} time`} className="w-40" value={per[k.key] === undefined ? 'same' : String(per[k.key])} onChange={(e) => setKind(k.key, e.target.value)}>
                  <option value="same">Same as above</option>
                  <option value="0">Never</option>
                  {DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
                </Select>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Warn me first</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              Show the countdown in red for the last
              <Select aria-label="Warn days" className="w-20" value={warn} onChange={(e) => setWarn(Number(e.target.value))}>
                {[0, 1, 3, 7, 14].map((d) => <option key={d} value={d}>{d}</option>)}
              </Select>
              days
            </div>
          </div>
          {ask && (
            <div role="alert" data-testid="auto-delete-confirm" className="rounded-lg border border-warn bg-warn-soft px-3 py-2.5 text-sm text-warn-ink">
              <b>{ask}</b>
              <div className="mt-2"><Button size="sm" variant="danger" loading={save.isPending} onClick={() => save.mutate(true)}>Yes, save anyway</Button></div>
            </div>
          )}
        </div>
      </SideContent>
    </Dialog>
  )
}
