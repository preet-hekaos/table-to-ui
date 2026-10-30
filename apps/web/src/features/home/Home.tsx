import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError } from '@/api/client'
import { admin, app, studio } from '@/api/endpoints'
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, LoadingState, useToast } from '@/design-system'
import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, CheckCircle2, Circle } from 'lucide-react'
import { can, useMe } from '@/features/auth/useMe'
import { FirstSteps, SampleData, WhatNeedsMe } from './WhatNeedsMe'

/** Screen 1.5: the app and its version, the setup checklist and pack updates (owners), and the
 *  governed measure cards, whose values come from the analytics store, never from live tables. */
function SetupCard() {
  const home = useQuery({ queryKey: ['ws-home'], queryFn: admin.home, retry: false })
  const me = useMe()
  const draft = useQuery({ queryKey: ['studio-status'], queryFn: studio.status, enabled: can(me.data?.permissions ?? [], 'metadata.write'), retry: false })
  if (!home.data) return null
  const h = home.data
  const done = h.checklist.filter((c) => c.done).length
  return (
    <div className="flex flex-col gap-4">
      <Card data-testid="setup-checklist">
        <div className="flex items-center gap-2">
          <CardTitle>Set up your workspace</CardTitle>
          <Badge tone={done === h.checklist.length ? 'ok' : 'neutral'} className="ml-auto">
            {done} of {h.checklist.length} done
          </Badge>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
          <div className="h-full rounded-full bg-ok" style={{ width: `${h.checklist.length ? (done / h.checklist.length) * 100 : 0}%` }} />
        </div>
        <ul className="mt-3 flex flex-col gap-2">
          {h.checklist.map((c) => (
            <li key={c.key} className="flex items-center gap-2 text-sm">
              {c.done ? <CheckCircle2 className="size-4 text-ok" aria-hidden /> : <Circle className="size-4 text-muted" aria-hidden />}
              <a href={c.to} className={c.done ? 'text-muted line-through' : 'font-semibold text-accent-ink hover:underline'}>
                {c.label}
              </a>
              <span className="sr-only">{c.done ? '(done)' : '(to do)'}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card data-testid="app-version">
        <CardTitle>Your app</CardTitle>
        <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Starting point</dt>
          <dd className="text-ink capitalize">{h.pack_id ? `${h.pack_id.replace('_', ' ')} ${h.pack_version ?? ''}` : 'Blank'}</dd>
          <dt className="text-muted">Live version</dt>
          <dd className="text-ink">{h.release_version ? `v${h.release_version}` : 'Not published'}</dd>
          <dt className="text-muted">Pack updates</dt>
          <dd className="text-ink">{h.pack_updates.length ? `${h.pack_updates.length} available` : 'Up to date'}</dd>
        </dl>
        {draft.data?.draft_changed && (
          <p className="mt-3 rounded-md border border-line bg-canvas p-2 text-sm text-ink" data-testid="draft-waiting">
            You have changes in Draft that people don’t see yet. Send them to Test, then make them Live from the Studio.
          </p>
        )}
        {h.pack_updates.map((u) => <PackUpdate key={u.version} u={u} />)}
        <Link to="/studio" className="mt-3 inline-block text-sm font-semibold text-accent-ink hover:underline">
          Open the Studio
        </Link>
      </Card>
    </div>
  )
}

function PackUpdate({ u }: { u: { pack_id: string; version: string; title: string; from: string } }) {
  const me = useMe()
  const qc = useQueryClient()
  const toast = useToast()
  const accept = useMutation({
    mutationFn: () => admin.acceptUpdate(u.version),
    onSuccess: async (r) => {
      const n = Object.values(r.changes).reduce((a, b) => a + b.length, 0)
      toast({ title: `Update ${u.version} is in your Draft`, description: `${n} changes. Review and publish them in the Studio.`, tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['ws-home'] })
    },
    onError: (e) => toast({ title: 'Could not take the update', description: (e as Error).message, tone: 'bad' }),
  })
  return (
    <div className="mt-3 rounded-md border border-line p-2 text-sm" data-testid="pack-update">
      <b className="text-ink">{u.title} {u.version}</b> <span className="text-muted">(you have {u.from})</span>
      {me.data?.permissions.includes('*') ? (
        <Button size="sm" className="mt-2 w-full" onClick={() => accept.mutate()} loading={accept.isPending}>Take this update</Button>
      ) : (
        <p className="text-xs text-muted">An owner can take this update.</p>
      )}
    </div>
  )
}


const PERIODS = [
  ['last_30_days', 'Last 30 days'],
  ['this_week', 'This week'],
  ['this_month', 'This month'],
  ['last_90_days', 'Last 90 days'],
  ['this_year', 'This year'],
] as const
const DOTS = ['bg-slate-400', 'bg-emerald-500', 'bg-blue-500', 'bg-violet-500', 'bg-orange-500', 'bg-pink-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500']
const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** A small line of the last few periods, drawn without any chart library. */
function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const max = Math.max(...points), min = Math.min(...points), span = max - min || 1
  const d = points.map((v, i) => `${i ? 'L' : 'M'}${(i / (points.length - 1)) * 80},${22 - ((v - min) / span) * 20}`).join(' ')
  return (
    <svg viewBox="0 0 80 24" className="h-6 w-20 text-accent" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Change({ now, before }: { now: number | null; before?: number | null }) {
  if (now == null || before == null) return null
  const diff = now - before
  if (diff === 0) return <span className="text-xs text-muted">No change</span>
  const up = diff > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-ok' : 'text-bad'}`} data-testid="measure-change">
      <Icon className="size-3.5" aria-hidden />
      {up ? '+' : ''}{diff} vs before
    </span>
  )
}

/** How many sit at each stage, as one stacked bar and a legend. */
function StageBars({ series }: { series: { label: string; value: number | null }[] }) {
  const total = series.reduce((a, p) => a + (p.value ?? 0), 0)
  if (!total) return null
  return (
    <Card data-testid="stage-bars">
      <CardTitle>Where submissions are</CardTitle>
      <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-line" role="img" aria-label={series.map((p) => `${p.label}: ${p.value ?? 0}`).join(', ')}>
        {series.map((p, i) => (p.value ? <div key={p.label} className={DOTS[i % DOTS.length]} style={{ width: `${((p.value ?? 0) / total) * 100}%` }} /> : null))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {series.map((p, i) => (
          <li key={p.label} className="inline-flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${DOTS[i % DOTS.length]}`} aria-hidden />
            {p.label} <b className="text-ink">{p.value ?? 0}</b>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function Home() {
  const me = useMe()
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('last_30_days')
  const [mine, setMine] = useState(false)
  const measures = useQuery({
    queryKey: ['measures', period, mine],
    queryFn: () => app.measures({ range: period }, true, { compare: true, mine }),
    enabled: !!me.data,
    retry: false,
    refetchInterval: 15_000,
  })
  const stages = useQuery({
    queryKey: ['measure-stages', period],
    queryFn: () => app.measure('submissions_by_stage', { range: period }),
    enabled: !!me.data && measures.isSuccess,
    retry: false,
  })
  if (!me.data) return null
  const canManage = can(me.data.permissions, 'workspace.manage')
  const notPublished = measures.error instanceof ApiError && measures.error.status === 404

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-ink">{greeting()}, {me.data.full_name.split(' ')[0]}</h1>
          <p className="text-sm text-muted">{me.data.tenant_name}</p>
        </div>
        {measures.isSuccess && (
          <div className="flex gap-2">
            <select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink">
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select aria-label="Whose numbers" value={mine ? 'mine' : 'all'} onChange={(e) => setMine(e.target.value === 'mine')} className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink">
              <option value="all">All users</option>
              <option value="mine">Only mine</option>
            </select>
          </div>
        )}
      </div>
      {measures.isLoading ? (
        <LoadingState label="Loading measures" />
      ) : notPublished ? (
        <EmptyState title="Your app is not live yet">
          {can(me.data.permissions, 'release.publish') ? (
            <>
              Publish it to Test, then Live, in the <Link to="/studio" className="font-semibold underline">Studio</Link>.
            </>
          ) : (
            'Ask your workspace admin to publish it.'
          )}
        </EmptyState>
      ) : measures.error ? (
        <ErrorState requestId={(measures.error as ApiError).requestId} onRetry={() => void measures.refetch()} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          {measures.data?.map((m) => (
            <Card key={m.key} data-testid={`measure-${m.key}`} className="px-4 py-3">
              <p className="text-xs font-medium text-muted">{m.label}</p>
              <Link to="/insights/$key" params={{ key: m.key }} className="mt-1 block w-fit text-[28px] leading-9 font-semibold text-ink hover:underline" aria-label={`${m.label}: ${m.value ?? 'no data'}. Show records`}>
                {m.value ?? '–'}
              </Link>
              <div className="flex items-center justify-between gap-2">
                <Change now={m.value} before={m.previous} />
                {m.trend && <Spark points={m.trend} />}
              </div>
              <p className="text-xs text-muted">{m.as_of ? `As of ${new Date(m.as_of).toLocaleTimeString()}` : 'No data yet'}</p>
            </Card>
          ))}
        </div>
      )}
      {stages.data?.series && <StageBars series={stages.data.series} />}
      <div className={`grid items-start gap-4 ${canManage ? 'lg:grid-cols-[2fr_1fr]' : ''}`}>
        <WhatNeedsMe />
        {canManage && <SetupCard />}
      </div>
      <SampleData />
      <FirstSteps />
      {measures.isSuccess && <Link to="/insights" className="w-fit text-sm font-semibold text-accent-ink underline">See all insights</Link>}
    </div>
  )
}
