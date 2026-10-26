import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { studio, type ManifestDiff } from '@/api/endpoints'
import type { ReleaseRow } from '@/api/types'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,
  Select,
  StageBadge,
  STAGES,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'
import { DataTab } from './DataTab'
import { useStages } from './useStages'
import { FlowTab } from './FlowTab'
import { AutomationsTab } from './AutomationsTab'
import { InsightsTab } from './InsightsTab'
import { LinkHealth } from './RelationshipsTab'
import { MapTab } from './MapTab'
import { NavTab } from './NavTab'
import { PreviewTab } from './PreviewTab'
import { SetupChat } from '@/features/ai/SetupChat'
import { ScreensTab } from './ScreensTab'

export type StudioTab = 'data' | 'map' | 'flow' | 'screens' | 'insights' | 'automations' | 'menu' | 'preview' | 'versions' | 'chat'

/** The three environments as a strip. Each step has its own colour, its version and how many items wait there. */
function EnvironmentSwitch({ releases }: { releases: ReleaseRow[] }) {
  const test = releases.find((r) => r.is_test)
  const live = releases.find((r) => r.is_live)
  const { report } = useStages()
  const c = report?.counts
  const steps = [
    { stage: 'draft' as const, value: 'editing', note: c ? `${c.draft + c.removed} waiting` : '' },
    { stage: 'test' as const, value: test ? `v${test.version}` : 'empty', note: c && c.test ? `${c.test} not yet Live` : '' },
    { stage: 'live' as const, value: live ? `v${live.version}` : 'not published', note: '' },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Environments">
      {steps.map((s, i) => {
        const def = STAGES[s.stage]
        return (
          <span key={s.stage} className="flex items-center gap-2">
            {i > 0 && <span className="text-muted" aria-hidden>→</span>}
            <span className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${def.badge}`} data-stage={s.stage} data-testid={`env-${s.stage}`}>
              <def.Icon className="size-4" aria-hidden />
              <b>{def.label}</b> {s.value}
              {s.note && <span className="text-xs">· {s.note}</span>}
            </span>
          </span>
        )
      })}
      <details className="relative">
        <summary className="cursor-pointer rounded-md px-2 py-1.5 text-xs font-semibold text-accent-ink hover:bg-soft">Colour key</summary>
        <ul className="absolute z-10 mt-1 flex w-72 flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-xs shadow-md" aria-label="What the colours mean">
          {(['draft', 'test', 'live', 'removed'] as const).map((k) => (
            <li key={k} className="flex flex-col gap-1">
              <StageBadge stage={k} className="self-start" />
              <span className="text-muted">{STAGES[k].meaning}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}

const KIND_LABEL: Record<string, string> = { tables: 'Tables', screens: 'Screens', navs: 'Menu', rules: 'Rules', measures: 'Measures', automations: 'Automations' }

export function DiffList({ diff }: { diff: ManifestDiff }) {
  if (!diff.changed) return <p className="text-sm text-muted">No differences.</p>
  return (
    <div className="flex flex-col gap-3" data-testid="diff">
      {(['tables', 'screens', 'navs', 'rules', 'measures', 'automations'] as const).map((kind) =>
        diff[kind].length === 0 ? null : (
          <section key={kind}>
            <h3 className="text-xs font-bold tracking-wide text-muted uppercase">{KIND_LABEL[kind]}</h3>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {diff[kind].map((d) => (
                <li key={d.key}>
                  <Badge tone={d.change === 'added' ? 'ok' : d.change === 'removed' ? 'bad' : 'warn'}>{d.change}</Badge>{' '}
                  <b className="text-ink">{d.key}</b>
                  {d.attributes && d.attributes.length > 0 && <span className="text-muted"> ({d.attributes.join(', ')})</span>}
                  {d.fields && d.fields.length > 0 && (
                    <ul className="mt-1 ml-5 list-disc text-body">
                      {d.fields.map((f) => (
                        <li key={f.field}>
                          {f.label}: {f.change}
                          {f.attributes &&
                            ' — ' +
                              Object.entries(f.attributes)
                                .map(([k, v]) => `${k} ${JSON.stringify(v.from)} → ${JSON.stringify(v.to)}`)
                                .join('; ')}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  )
}

function useRefresh() {
  const qc = useQueryClient()
  return () =>
    Promise.all(
      ['releases', 'live-tables', 'measures', 'studio-status', 'approvals', 'navigation', 'compare'].map((k) => qc.invalidateQueries({ queryKey: [k] })),
    )
}

function DraftBanner({ canPublish, onReview }: { canPublish: boolean; onReview: () => void }) {
  const status = useQuery({ queryKey: ['studio-status'], queryFn: studio.status, retry: false })
  const toast = useToast()
  const refresh = useRefresh()
  const publish = useMutation({
    mutationFn: studio.publishTest,
    onSuccess: async (r) => {
      toast({ title: `Version ${r.version} is in Test`, description: 'Make it Live from Versions.', tone: 'ok' })
      await refresh()
    },
    onError: (e) => toast({ title: 'Could not publish', description: e.message, tone: 'bad' }),
  })
  const d = status.data
  if (!d?.draft_changed) return null
  const count = (['tables', 'screens', 'navs', 'rules', 'measures', 'automations'] as const).reduce((n, k) => n + d.changes[k].length, 0)
  return (
    <div className="flex flex-col gap-2">
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-warn-soft bg-warn-soft px-4 py-3 text-sm text-warn-ink" data-testid="draft-banner">
      <span>
        <b>The Draft has {count} unpublished change{count === 1 ? '' : 's'}.</b> Nobody sees them until they are published and made Live.
      </span>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onReview}>
        Review changes
      </Button>
      {canPublish && (
        <Button size="sm" variant="primary" onClick={() => publish.mutate()} loading={publish.isPending}>
          Publish Draft to Test
        </Button>
      )}
    </div>
    <LinkHealth compact />
    </div>
  )
}

function Compare({ releases }: { releases: ReleaseRow[] }) {
  const live = releases.find((r) => r.is_live)
  const [from, setFrom] = useState(String(live?.version ?? releases.at(-1)?.version ?? 1))
  const [to, setTo] = useState('draft')
  const diff = useQuery({ queryKey: ['compare', from, to], queryFn: () => studio.compare(from, to), retry: false })
  const options = [
    <option key="draft" value="draft">
      Draft
    </option>,
    ...releases.map((r) => (
      <option key={r.version} value={String(r.version)}>
        Version {r.version}
        {r.is_live ? ' (Live)' : r.is_test ? ' (Test)' : ''}
      </option>
    )),
  ]
  return (
    <Card>
      <h2 className="text-base font-bold text-ink">Compare</h2>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <Select aria-label="Compare from" className="w-48" value={from} onChange={(e) => setFrom(e.target.value)}>
          {options}
        </Select>
        <span className="text-muted">with</span>
        <Select aria-label="Compare with" className="w-48" value={to} onChange={(e) => setTo(e.target.value)}>
          {options}
        </Select>
      </div>
      <div className="mt-4">
        {diff.isLoading ? <LoadingState label="Comparing" /> : diff.isError ? <ErrorState requestId={(diff.error as ApiError).requestId} /> : diff.data && <DiffList diff={diff.data} />}
      </div>
    </Card>
  )
}

function Approvals({ isOwner }: { isOwner: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: studio.approvals, retry: false })
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => studio.decide(id, approve),
    onSuccess: async (r) => {
      toast({ title: r.status === 'live' ? `Version ${r.version} is now Live` : `Version ${r.version} was turned down`, tone: 'ok' })
      await refresh()
    },
    onError: (e) => toast({ title: 'Could not decide', description: e.message, tone: 'bad' }),
  })
  const pending = (approvals.data ?? []).filter((a) => a.status === 'pending')
  if (pending.length === 0) return null
  return (
    <Card data-testid="approvals">
      <h2 className="text-base font-bold text-ink">Waiting for an owner</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {pending.map((a) => (
          <li key={a.approval_id} className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              <b className="text-ink">Version {a.version}</b> — {a.requested_by} asked for it to go Live
            </span>
            {isOwner ? (
              <span className="ml-auto flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: a.approval_id, approve: false })}>
                  Turn down
                </Button>
                <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: a.approval_id, approve: true })} loading={decide.isPending}>
                  Approve and make Live
                </Button>
              </span>
            ) : (
              <Badge tone="warn" className="ml-auto">
                Waiting
              </Badge>
            )}
          </li>
        ))}
      </ul>
    </Card>
  )
}

function VersionsTab({ releases, canPublish, isOwner }: { releases: ReleaseRow[]; canPublish: boolean; isOwner: boolean }) {
  const toast = useToast()
  const refresh = useRefresh()
  const fail = (e: Error) => toast({ title: 'Could not do that', description: e.message, tone: 'bad' })
  const publish = useMutation({
    mutationFn: studio.publishTest,
    onSuccess: async (r) => {
      toast({ title: `Version ${r.version} is in Test`, tone: 'ok' })
      await refresh()
    },
    onError: fail,
  })
  const promote = useMutation({
    mutationFn: (v: number) => studio.promote(v),
    onSuccess: async (r) => {
      toast(
        r.status === 'live'
          ? { title: `Version ${r.version} is now Live`, tone: 'ok' }
          : { title: `Version ${r.version} is waiting for an owner`, description: 'An owner must approve it before it goes Live.', tone: 'ok' },
      )
      await refresh()
    },
    onError: fail,
  })
  const rollback = useMutation({
    mutationFn: studio.rollback,
    onSuccess: async (r) => {
      toast({ title: `Rolled back to version ${r.version}`, tone: 'ok' })
      await refresh()
    },
    onError: fail,
  })
  return (
    <div className="flex flex-col gap-4">
      {canPublish && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => publish.mutate()} loading={publish.isPending}>
            Publish Draft to Test
          </Button>
          <Button variant="danger" onClick={() => rollback.mutate()} loading={rollback.isPending} disabled={releases.filter((r) => r.is_live).length === 0}>
            Roll back Live
          </Button>
        </div>
      )}
      <Approvals isOwner={isOwner} />
      {releases.length > 0 && <Compare releases={releases} />}
      {releases.length === 0 ? (
        <EmptyState title="No versions yet">Publish the Draft to Test to create version 1.</EmptyState>
      ) : (
        releases.map((r) => (
          <Card key={r.release_id} data-testid={`release-v${r.version}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-ink">Version {r.version}</h2>
              {r.is_test && <Badge tone="warn">Test</Badge>}
              {r.is_live && <Badge tone="ok">Live</Badge>}
              <span className="text-xs text-muted">{new Date(r.created_at).toLocaleString()}</span>
              {canPublish && !r.is_live && (
                <Button className="ml-auto" size="sm" variant="primary" onClick={() => promote.mutate(r.version)} loading={promote.isPending && promote.variables === r.version}>
                  {isOwner ? 'Make Live' : 'Ask an owner to make Live'}
                </Button>
              )}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-accent-ink">Manifest</summary>
              <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">Pack</dt>
                <dd className="text-ink">{r.manifest.pack ? `${r.manifest.pack.id} ${r.manifest.pack.version}` : 'none'}</dd>
                {(['tables', 'rules', 'measures', 'automations'] as const).map((kind) => (
                  <div key={kind} className="contents">
                    <dt className="text-muted capitalize">{kind}</dt>
                    <dd className="text-ink">
                      {Object.entries(r.manifest[kind] ?? {}).map(([k, v]) => (
                        <span key={k} className="mr-3 inline-block">
                          {k} v{v.version} <code className="font-mono text-muted">{v.hash.slice(0, 8)}</code>
                        </span>
                      ))}
                    </dd>
                  </div>
                ))}
                <dt className="text-muted">Manifest hash</dt>
                <dd className="font-mono text-muted">{r.manifest_hash.slice(0, 16)}</dd>
              </dl>
            </details>
          </Card>
        ))
      )}
    </div>
  )
}

/** The Studio: screens 2.4 to 2.8, 2.15 and 2.16. Every change lands in the Draft first. */
export function Studio({ tab = 'data', table }: { tab?: StudioTab; table?: string }) {
  const me = useMe()
  const navigate = useNavigate()
  const releases = useQuery({ queryKey: ['releases'], queryFn: studio.releases, enabled: !!me.data, retry: false })
  const nav = useQuery({ queryKey: ['studio-nav'], queryFn: studio.navigation, enabled: !!me.data, retry: false })
  const screens = useQuery({ queryKey: ['studio-screens'], queryFn: studio.screens, enabled: !!me.data, retry: false })
  if (!me.data) return null
  const perms = me.data.permissions
  if (!can(perms, 'metadata.read')) return <PermissionDenied what="The Studio is for workspace admins." />
  if (releases.isLoading) return <LoadingState label="Loading the Studio" />
  if (releases.isError) return <ErrorState requestId={(releases.error as ApiError).requestId} onRetry={() => void releases.refetch()} />
  const go = (next: { tab?: StudioTab; table?: string }) => void navigate({ to: '/studio', search: { tab: next.tab ?? tab, table: next.table ?? table } })
  const firstScreen = nav.data?.find((n) => n.section === 'main') ?? nav.data?.[0]
  const defaultTable = screens.data?.find((s) => s.key === firstScreen?.screen)?.table
  const canEdit = can(perms, 'metadata.write')
  const canPublish = can(perms, 'release.publish')
  const isOwner = perms.includes('*')
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Studio</h1>
        <EnvironmentSwitch releases={releases.data ?? []} />
        <a href="/patterns" className="ml-auto text-sm font-semibold text-accent-ink hover:underline">Pattern library</a>
      </div>
      <DraftBanner canPublish={canPublish} onReview={() => go({ tab: 'versions' })} />
      {!can(perms, 'ai.setup') && (
        <p className="text-xs text-muted" data-testid="chat-setup-hint">Ask an owner for setup access to build with chat.</p>
      )}
      <Tabs value={tab} onValueChange={(v) => go({ tab: v as StudioTab })}>
        <TabsList aria-label="Studio sections" className="overflow-x-auto">
          {can(perms, 'ai.setup') && <TabsTrigger value="chat">Set up by chat</TabsTrigger>}
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="map">Canvas</TabsTrigger>
          <TabsTrigger value="flow">Stages &amp; rules</TabsTrigger>
          <TabsTrigger value="screens">Screens</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="menu">Menu</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>
        <TabsContent value="chat" className="pt-4">
          <SetupChat />
        </TabsContent>
        <TabsContent value="data" className="pt-4">
          <DataTab selected={table} defaultTable={defaultTable} onSelect={(k) => go({ table: k })} canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="map" className="pt-4">
          <MapTab canEdit={canEdit} onOpen={(k) => go({ tab: 'data', table: k })} />
        </TabsContent>
        <TabsContent value="flow" className="pt-4">
          <FlowTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="screens" className="pt-4">
          <ScreensTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="insights" className="pt-4">
          <InsightsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="automations" className="pt-4">
          <AutomationsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="menu" className="pt-4">
          <NavTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="preview" className="pt-4">
          <PreviewTab />
        </TabsContent>
        <TabsContent value="versions" className="pt-4">
          <VersionsTab releases={releases.data ?? []} canPublish={canPublish} isOwner={isOwner} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
