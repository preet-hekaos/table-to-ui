import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { me, sample } from '@/api/endpoints'
import { Badge, Button, Card, CardTitle, useToast } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'

const day = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

/** What needs me: my open to-dos (soonest first), changes waiting for my decision, what I have not read. */
export function WhatNeedsMe() {
  const qc = useQueryClient()
  const toast = useToast()
  const needs = useQuery({ queryKey: ['needs'], queryFn: me.needs, retry: false, refetchInterval: 15_000 })
  const finish = useMutation({
    mutationFn: ({ table, id }: { table: string; id: string }) => me.finishTask(table, id),
    onSuccess: async () => {
      toast({ title: 'Marked as done', tone: 'ok' })
      await Promise.all(['needs', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: (e) => toast({ title: 'Could not mark it done', description: (e as Error).message, tone: 'bad' }),
  })
  const unreadNow = needs.data?.unread
  useEffect(() => {
    // keep the bell in step with what Home just learned
    void qc.invalidateQueries({ queryKey: ['notifications'] })
  }, [qc, unreadNow])
  if (!needs.data) return null
  const today = new Date().toLocaleDateString('en-CA')
  const { tasks, approvals, unread } = needs.data
  const nothing = !tasks?.total && !approvals && !unread
  return (
    <Card data-testid="what-needs-me" aria-labelledby="needs-title">
      <div className="flex items-center gap-2">
        <CardTitle id="needs-title">What needs me</CardTitle>
        {!nothing && <Badge tone="neutral" className="ml-auto">{(tasks?.total ?? 0) + approvals + unread} items</Badge>}
      </div>
      {nothing ? (
        <p className="mt-2 text-sm text-muted">You are all caught up.</p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          {tasks && tasks.total > 0 && (
            <section aria-label={tasks.label}>
              <p className="text-xs font-semibold text-muted">
                {tasks.label} · {tasks.total} open
              </p>
              <ul className="mt-1 flex flex-col divide-y divide-line">
                {tasks.items.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-1.5" data-testid="needs-task">
                    <Link to="/records/$table/$id" params={{ table: tasks.table, id: t.id }} className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">
                      {t.title}
                    </Link>
                    {t.due_on && <Badge tone={t.overdue ? 'bad' : t.due_on === today ? 'warn' : 'ok'}>{t.overdue ? `Overdue · ${day(t.due_on)}` : t.due_on === today ? 'Due today' : `Due ${day(t.due_on)}`}</Badge>}
                    {t.can_finish && (
                      <Button size="sm" variant="secondary" aria-label={`Mark done: ${t.title}`} onClick={() => finish.mutate({ table: tasks.table, id: t.id })} disabled={finish.isPending}>
                        Done
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {approvals > 0 && (
            <p className="text-sm text-ink">
              <Link to="/approvals" className="font-semibold text-accent-ink hover:underline">{approvals} change{approvals === 1 ? '' : 's'} waiting for your decision</Link>
            </p>
          )}
          {unread > 0 && <p className="text-sm text-muted">{unread} unread notification{unread === 1 ? '' : 's'}. Open the bell at the top to read {unread === 1 ? 'it' : 'them'}.</p>}
        </div>
      )}
    </Card>
  )
}

/** First steps for my role. Each step ticks itself once I have done it; I can put the list away and bring it back. */
export function FirstSteps() {
  const qc = useQueryClient()
  const guide = useQuery({ queryKey: ['guide'], queryFn: me.guide, retry: false })
  const set = useMutation({
    mutationFn: me.setGuide,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['guide'] }),
  })
  const g = guide.data
  if (!g) return null
  if (g.dismissed) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => set.mutate(false)}>Help: show {g.title.toLowerCase()}</Button>
      </div>
    )
  }
  return (
    <Card data-testid="first-steps" aria-labelledby="steps-title">
      <div className="flex items-center gap-2">
        <CardTitle id="steps-title">{g.title}</CardTitle>
        <Badge tone={g.done === g.total ? 'ok' : 'neutral'} className="ml-auto">{g.done} of {g.total} done</Badge>
        <Button size="sm" variant="ghost" onClick={() => set.mutate(true)} aria-label="Hide first steps">Hide</Button>
      </div>
      <ul className="mt-2 flex flex-col gap-2">
        {g.steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2 text-sm">
            {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
            <div>
              <a href={s.path} className={s.done ? 'text-muted line-through' : 'font-semibold text-accent-ink hover:underline'}>{s.title}</a>
              <span className="sr-only">{s.done ? ' (done)' : ' (to do)'}</span>
              {s.help && !s.done && <p className="text-xs text-muted">{s.help}</p>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** For people who can import: try the app with a few made-up records, then remove them in one step. */
export function SampleData() {
  const qc = useQueryClient()
  const toast = useToast()
  const person = useMe()
  const status = useQuery({ queryKey: ['sample'], queryFn: sample.status, retry: false, enabled: !!person.data && can(person.data.permissions, 'import.run') })
  const done = async () => {
    await qc.invalidateQueries()
  }
  const load = useMutation({
    mutationFn: sample.load,
    onSuccess: async (r) => {
      toast({ title: `Added ${r.count} sample records`, description: 'Remove them in one step when you are ready.', tone: 'ok' })
      await done()
    },
    onError: (e) => toast({ title: 'Could not add sample data', description: (e as Error).message, tone: 'bad' }),
  })
  const remove = useMutation({
    mutationFn: sample.remove,
    onSuccess: async (r) => {
      toast({ title: `Removed ${r.removed} sample records`, tone: 'ok' })
      await done()
    },
    onError: (e) => toast({ title: 'Could not remove sample data', description: (e as Error).message, tone: 'bad' }),
  })
  if (!status.data?.available) return null
  return (
    <Card data-testid="sample-data">
      <CardTitle>Try it with sample data</CardTitle>
      <p className="mt-1 text-sm text-muted">
        {status.data.loaded ? `${status.data.count} sample records are in your workspace.` : 'Add a few made-up records to look around. They are marked “Sample” and go in one step.'}
      </p>
      {status.data.loaded ? (
        <Button className="mt-2" variant="secondary" onClick={() => remove.mutate()} loading={remove.isPending}>Remove sample data</Button>
      ) : (
        <Button className="mt-2" onClick={() => load.mutate()} loading={load.isPending}>Add sample data</Button>
      )}
    </Card>
  )
}
