import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { duplicates } from '@/api/endpoints'
import type { DuplicatePair } from '@/api/types'
import { can, useMe } from '@/features/auth/useMe'
import { Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, LoadingState, Table, Td, Th, useToast } from '@/design-system'

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v))

/** Pattern: suspected duplicates, side by side. Merge folds one record into the other and can be undone for seven days. */
export function DuplicateReview({ tableKey, title }: { tableKey: string; title: string }) {
  const me = useMe()
  const toast = useToast()
  const qc = useQueryClient()
  const mayMerge = can(me.data?.permissions, `record.${tableKey}.merge`)
  const pairs = useQuery({ queryKey: ['duplicates', tableKey], queryFn: () => duplicates.pairs(tableKey), retry: false })
  const merges = useQuery({ queryKey: ['merges', tableKey], queryFn: () => duplicates.merges(tableKey), retry: false })
  const [open, setOpen] = useState<DuplicatePair | null>(null)
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['duplicates', tableKey] }), qc.invalidateQueries({ queryKey: ['merges', tableKey] })])
  const dismiss = useMutation({
    mutationFn: (p: DuplicatePair) => duplicates.dismiss(tableKey, p.a.id, p.b.id),
    onSuccess: async () => {
      toast({ title: 'Marked as not a duplicate.', tone: 'ok' })
      await refresh()
    },
  })
  const undo = useMutation({
    mutationFn: (id: string) => duplicates.undo(tableKey, id),
    onSuccess: async () => {
      toast({ title: 'Merge undone. Both records are back.', tone: 'ok' })
      await refresh()
    },
    onError: (e) => toast({ title: e instanceof ApiError ? e.message : 'Could not undo.', tone: 'bad' }),
  })

  if (pairs.isLoading) return <LoadingState label="Looking for duplicates" />
  if (pairs.isError) return <ErrorState requestId={(pairs.error as ApiError).requestId} onRetry={() => void pairs.refetch()} />
  const items = pairs.data?.items ?? []
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <p className="text-sm text-muted">Records that look like the same person. Compare them, then merge or mark them as different.</p>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No suspected duplicates">When two records look alike, they appear here for review.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Suspected duplicates">
          {items.map((p) => (
            <li key={p.a.id + p.b.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink break-words">
                  {show(p.a.label)} <span className="font-normal text-muted">and</span> {show(p.b.label)}
                </p>
                <p className="text-xs text-muted">Same employer and a {p.score}% name match.</p>
              </div>
              <Button size="sm" onClick={() => setOpen(p)}>Compare</Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss.mutate(p)}>Not a duplicate</Button>
            </li>
          ))}
        </ul>
      )}
      {(merges.data?.length ?? 0) > 0 && (
        <section aria-labelledby="merges-h">
          <h2 id="merges-h" className="mb-2 text-sm font-bold text-ink">Recent merges</h2>
          <Table aria-label="Recent merges">
            <thead>
              <tr><Th>Merged away</Th><Th>When</Th><Th>Links moved</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr>
            </thead>
            <tbody>
              {merges.data!.map((m) => (
                <tr key={m.id}>
                  <Td>{show(m.merged_label)}</Td>
                  <Td>{new Date(m.merged_at).toLocaleString()}</Td>
                  <Td>{m.relinked}</Td>
                  <Td>{m.undone ? <Badge>Undone</Badge> : m.can_undo ? <Badge tone="ok">Can undo</Badge> : <Badge>Final</Badge>}</Td>
                  <Td>{m.can_undo && mayMerge && <Button size="sm" loading={undo.isPending} onClick={() => undo.mutate(m.id)}>Undo merge</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open && (
          <CompareDialog
            tableKey={tableKey}
            pair={open}
            mayMerge={mayMerge}
            onDone={async () => {
              setOpen(null)
              await refresh()
            }}
          />
        )}
      </Dialog>
    </div>
  )
}

function CompareDialog({ tableKey, pair, mayMerge, onDone }: { tableKey: string; pair: DuplicatePair; mayMerge: boolean; onDone: () => Promise<void> }) {
  const toast = useToast()
  const cmp = useQuery({ queryKey: ['compare', tableKey, pair.a.id, pair.b.id], queryFn: () => duplicates.compare(tableKey, pair.a.id, pair.b.id) })
  const [keep, setKeep] = useState<'a' | 'b'>('a')
  const [take, setTake] = useState<Record<string, 'a' | 'b'>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function merge() {
    const keepId = keep === 'a' ? pair.a.id : pair.b.id
    const dropId = keep === 'a' ? pair.b.id : pair.a.id
    const other = keep === 'a' ? 'b' : 'a'
    // A field is taken from the record being archived only when the person chose that side for it.
    const fromDrop = Object.fromEntries(Object.entries(take).filter(([, side]) => side === other).map(([k]) => [k, 'drop']))
    setBusy(true)
    setError(null)
    try {
      const r = await duplicates.merge(tableKey, keepId, dropId, fromDrop)
      toast({ title: `Merged. ${r.relinked} linked ${r.relinked === 1 ? 'record was' : 'records were'} moved. You can undo for 7 days.`, tone: 'ok' })
      await onDone()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Nothing was merged.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent title="Compare records" description="Choose the record to keep. Pick which value wins where they differ.">
      {cmp.isLoading ? (
        <LoadingState label="Comparing" />
      ) : cmp.isError || !cmp.data ? (
        <ErrorState onRetry={() => void cmp.refetch()} />
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto">
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 text-xs font-semibold text-ink">Keep this record</legend>
            {(['a', 'b'] as const).map((s) => (
              <label key={s} className="flex items-center gap-2">
                <input type="radio" name="keep" checked={keep === s} onChange={() => setKeep(s)} />
                {show(s === 'a' ? pair.a.label : pair.b.label)}
              </label>
            ))}
          </fieldset>
          <Table aria-label="Differences">
            <thead>
              <tr><Th>Field</Th><Th>{show(pair.a.label)}</Th><Th>{show(pair.b.label)}</Th></tr>
            </thead>
            <tbody>
              {cmp.data.fields.map((f) => (
                <tr key={f.key}>
                  <Td className="font-semibold">{f.label}</Td>
                  {(['a', 'b'] as const).map((s) => (
                    <Td key={s}>
                      {f.same ? (
                        show(f[s])
                      ) : (
                        <label className="flex items-start gap-2">
                          <input
                            type="radio"
                            name={`take-${f.key}`}
                            aria-label={`Use ${show(s === 'a' ? pair.a.label : pair.b.label)}'s ${f.label}`}
                            checked={(take[f.key] ?? keep) === s}
                            onChange={() => setTake((t) => ({ ...t, [f.key]: s }))}
                          />
                          <span className="break-words">{show(f[s])}</span>
                        </label>
                      )}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          {cmp.data.links.length > 0 && (
            <p className="text-sm text-body">
              Linked records that move to the one you keep:{' '}
              {cmp.data.links.map((l) => `${l.label}: ${keep === 'a' ? l.b : l.a} moving`).join(', ')}.
            </p>
          )}
          {!mayMerge && <p role="status" className="rounded-md bg-soft p-2 text-sm text-body">Only a manager can merge records. You can still mark them as different.</p>}
          {error && <p role="alert" className="rounded-md bg-bad-soft p-2 text-sm text-bad-ink">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="primary" disabled={!mayMerge} loading={busy} onClick={() => void merge()}>
              Merge into the kept record
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  )
}
