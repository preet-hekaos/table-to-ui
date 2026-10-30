import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError } from '@/api/client'
import { admin, app, studio } from '@/api/endpoints'
import { Badge, Button, Card, CardTitle, EmptyState, ErrorState, LoadingState, useToast } from '@/design-system'
import { CheckCircle2, Circle } from 'lucide-react'
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
        <ul className="mt-2 flex flex-col gap-2">
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

export function Home() {
  const me = useMe()
  const measures = useQuery({
    queryKey: ['measures'],
    queryFn: () => app.measures({}, true),
    enabled: !!me.data,
    retry: false,
    refetchInterval: 15_000,
  })
  if (!me.data) return null
  const canManage = can(me.data.permissions, 'workspace.manage')
  const notPublished = measures.error instanceof ApiError && measures.error.status === 404

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Welcome, {me.data.full_name.split(' ')[0]}</h1>
        <p className="text-sm text-muted">{me.data.tenant_name}</p>
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
              <p className="text-xs text-muted">{m.as_of ? `As of ${new Date(m.as_of).toLocaleTimeString()}` : 'No data yet'}</p>
            </Card>
          ))}
        </div>
      )}
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
