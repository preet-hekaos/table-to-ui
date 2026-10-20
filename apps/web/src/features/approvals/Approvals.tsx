import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { approvals } from '@/api/endpoints'
import type { HeldChange } from '@/api/types'
import { can, useMe } from '@/features/auth/useMe'
import { Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, Field, Input, LoadingState, Tabs, TabsContent, TabsList, TabsTrigger, useToast } from '@/design-system'

const tone = { pending: 'warn', approved: 'ok', rejected: 'bad', cancelled: 'neutral', failed: 'bad' } as const

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i

/** What the held change would write, in plain words: ids of linked records are left out. */
function describe(a: HeldChange) {
  return Object.entries(a.payload)
    .filter(([, v]) => !(typeof v === 'string' && UUID.test(v)))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'number' ? v.toLocaleString('en-IN') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

/** Screen: changes that rules hold for a manager. Approvers decide; requesters follow their own. */
export function Approvals() {
  const me = useMe()
  const toast = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState<'pending' | 'done'>('pending')
  const decider = can(me.data?.permissions, 'approval.decide')
  const list = useQuery({ queryKey: ['approvals', tab], queryFn: () => approvals.list(tab === 'pending' ? 'pending' : null), retry: false })
  const [rejecting, setRejecting] = useState<HeldChange | null>(null)
  const [note, setNote] = useState('')
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['approvals'] }), qc.invalidateQueries({ queryKey: ['board'] })])
  const decide = useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note: string }) => approvals.decide(v.id, v.decision, v.note),
    onSuccess: async (_r, v) => {
      toast({ title: v.decision === 'approve' ? 'Approved and applied.' : 'Rejected.', tone: 'ok' })
      setRejecting(null)
      setNote('')
      await refresh()
    },
    onError: async (e) => {
      toast({ title: e instanceof ApiError ? e.message : 'Something went wrong.', tone: 'bad' })
      await refresh()
    },
  })
  const cancel = useMutation({
    mutationFn: (id: string) => approvals.cancel(id),
    onSuccess: async () => {
      toast({ title: 'Request cancelled.', tone: 'ok' })
      await refresh()
    },
  })

  const rows = list.data?.items ?? []
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Approvals</h1>
        <p className="text-sm text-muted">
          {decider ? 'Changes that a rule holds until a manager decides. You cannot decide your own.' : 'Changes you asked for that a rule is holding for a manager.'}
        </p>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as 'pending' | 'done')}>
        <TabsList aria-label="Approvals">
          <TabsTrigger value="pending">Waiting{list.data && tab === 'pending' ? ` (${list.data.pending})` : ''}</TabsTrigger>
          <TabsTrigger value="done">History</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          {list.isLoading ? (
            <LoadingState label="Loading approvals" />
          ) : list.isError ? (
            <ErrorState requestId={(list.error as ApiError).requestId} onRetry={() => void list.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState title={tab === 'pending' ? 'Nothing is waiting for approval' : 'No decisions yet'}>
              {tab === 'pending' ? 'When a rule holds a change, such as an offer above budget, it shows up here.' : 'Approved and rejected requests appear here.'}
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Approval requests">
              {rows.map((a) => {
                const mine = a.requested_by === me.data?.user_id
                return (
                  <li key={a.id} className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-bold text-ink">
                        {a.record_id ? (
                          <Link to="/records/$table/$id" params={{ table: a.table, id: a.record_id }} className="hover:underline">{a.title}</Link>
                        ) : (
                          a.title
                        )}
                      </h2>
                      <Badge tone="neutral">{a.action === 'create' ? 'New' : 'Change'} · {a.table.replace(/_/g, ' ')}</Badge>
                      <Badge tone={tone[a.status]}>{a.status}</Badge>
                    </div>
                    <ul className="text-sm text-body">
                      {a.checks.map((c) => (
                        <li key={c.check}>{c.message}</li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted break-words">{describe(a)}</p>
                    <p className="text-xs text-muted">
                      Asked by {a.requested_by_name ?? 'someone'} on {new Date(a.requested_at).toLocaleDateString()}
                      {a.note ? ` — “${a.note}”` : ''}
                    </p>
                    {a.decided_by_name && (
                      <p className="text-xs text-muted">
                        {a.status === 'cancelled' ? 'Cancelled' : a.status === 'failed' ? 'Failed' : `${a.status === 'approved' ? 'Approved' : 'Rejected'} by ${a.decided_by_name}`}
                        {a.decision_note ? ` — “${a.decision_note}”` : ''}
                        {a.error ? ` — ${a.error}` : ''}
                      </p>
                    )}
                    {a.status === 'pending' && (
                      <div className="flex flex-wrap gap-2">
                        {decider && !mine && (
                          <>
                            <Button size="sm" variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ id: a.id, decision: 'approve', note: '' })}>
                              Approve
                            </Button>
                            <Button size="sm" variant="danger" onClick={() => setRejecting(a)}>
                              Reject
                            </Button>
                          </>
                        )}
                        {decider && mine && <p className="text-xs text-muted">Another manager has to decide this one.</p>}
                        {mine && (
                          <Button size="sm" onClick={() => cancel.mutate(a.id)}>
                            Cancel request
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        {rejecting && (
          <DialogContent title={`Reject “${rejecting.title}”`} description="Say why, so the person who asked knows what to change.">
            <Field label="Reason" required>
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setRejecting(null)}>Cancel</Button>
              <Button variant="danger" disabled={!note.trim()} loading={decide.isPending} onClick={() => decide.mutate({ id: rejecting.id, decision: 'reject', note })}>
                Reject
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}
