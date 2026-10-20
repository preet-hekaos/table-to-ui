import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { ReleaseRow } from '@/api/types'
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionDenied,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  useToast,
} from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'

const sourceTone = (s: string) => (s === 'pack' ? 'accent' : 'neutral')

function EnvironmentSwitch({ releases }: { releases: ReleaseRow[] }) {
  const test = releases.find((r) => r.is_test)
  const live = releases.find((r) => r.is_live)
  const chip = (label: string, value: string, active: boolean) => (
    <span className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${active ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface text-muted'}`}>
      <b className="text-ink">{label}</b> {value}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Environments">
      {chip('Draft', 'editing', true)}
      {chip('Test', test ? `v${test.version}` : 'empty', !!test)}
      {chip('Live', live ? `v${live.version}` : 'not published', !!live)}
    </div>
  )
}

function DataTab() {
  const tables = useQuery({ queryKey: ['studio-tables'], queryFn: studio.tables, retry: false })
  if (tables.isLoading) return <LoadingState label="Loading tables" />
  if (tables.isError) return <ErrorState requestId={(tables.error as ApiError).requestId} onRetry={() => void tables.refetch()} />
  return (
    <div className="flex flex-col gap-4">
      {tables.data?.map((t) => (
        <Card key={t.key} className="p-0">
          <div className="flex items-center gap-2 border-b border-line p-3">
            <h2 className="text-sm font-bold text-ink">{t.label}</h2>
            <Badge>{t.fields.length} fields</Badge>
          </div>
          <Table aria-label={`${t.label} fields`}>
            <thead>
              <tr>
                <Th>Field</Th>
                <Th>Type</Th>
                <Th>Required</Th>
                <Th>Comes from</Th>
              </tr>
            </thead>
            <tbody>
              {t.fields.map((f) => (
                <tr key={f.key}>
                  <Td className="font-semibold text-ink">{f.label}</Td>
                  <Td>{f.type.replace('_', ' ')}</Td>
                  <Td>{f.required ? 'Yes' : 'No'}</Td>
                  <Td><Badge tone={sourceTone(f.source)}>{f.source === 'pack' ? 'Pack' : 'Workspace'}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
    </div>
  )
}

function VersionsTab({ releases, canPublish }: { releases: ReleaseRow[]; canPublish: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['releases'] }), qc.invalidateQueries({ queryKey: ['live-tables'] }), qc.invalidateQueries({ queryKey: ['measures'] })])
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
      toast({ title: `Version ${r.version} is now Live`, tone: 'ok' })
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
                  Make Live
                </Button>
              )}
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-semibold text-accent-ink">Manifest</summary>
              <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">Pack</dt>
                <dd className="text-ink">{r.manifest.pack.id} {r.manifest.pack.version}</dd>
                {(['tables', 'rules', 'measures'] as const).map((kind) => (
                  <div key={kind} className="contents">
                    <dt className="text-muted capitalize">{kind}</dt>
                    <dd className="text-ink">
                      {Object.entries(r.manifest[kind]).map(([k, v]) => (
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

/** Screens 2.1 and 2.4 in basic form: environments, versions and a read-only view of tables and fields. */
export function Studio() {
  const me = useMe()
  const releases = useQuery({ queryKey: ['releases'], queryFn: studio.releases, enabled: !!me.data, retry: false })
  if (!me.data) return null
  if (!can(me.data.permissions, 'metadata.read')) return <PermissionDenied what="The Studio is for workspace admins." />
  if (releases.isLoading) return <LoadingState label="Loading the Studio" />
  if (releases.isError) return <ErrorState requestId={(releases.error as ApiError).requestId} onRetry={() => void releases.refetch()} />
  const data = releases.data ?? []
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Studio</h1>
        <EnvironmentSwitch releases={data} />
      </div>
      <Tabs defaultValue="data">
        <TabsList aria-label="Studio sections">
          <TabsTrigger value="data">Data</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>
        <TabsContent value="data" className="pt-4">
          <DataTab />
        </TabsContent>
        <TabsContent value="versions" className="pt-4">
          <VersionsTab releases={data} canPublish={can(me.data.permissions, 'release.publish')} />
        </TabsContent>
      </Tabs>
      <CardTitle className="sr-only">Studio</CardTitle>
    </div>
  )
}
