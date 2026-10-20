import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Pencil, Plus, Sparkles } from 'lucide-react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import { Badge, Button, Card, ErrorState, LoadingState, NotFound, PermissionDenied, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'
import { formatField } from '@/patterns/format'
import { ProfileFields } from '@/patterns/ProfilePage'
import { ProfileSide, useProfile, useTimeline } from '@/patterns/ProfileSide'

function describe(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before) return 'Created'
  const changed = Object.keys(after ?? {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify((after ?? {})[k]))
  return changed.length ? `Changed ${changed.join(', ')}` : 'Saved with no changes'
}

/** Thin 3.5: one record with its fields grouped as the pack defines them, and its history. */
export function RecordDetail({ tableKey, id, embedded = false }: { tableKey: string; id: string; embedded?: boolean }) {
  const me = useMe()
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const rec = useQuery({ queryKey: ['record', tableKey, id], queryFn: () => app.get(tableKey, id), retry: false })
  const relations = useQuery({ queryKey: ['relations', tableKey], queryFn: () => app.relations(tableKey), retry: false })
  const hist = useQuery({ queryKey: ['history', tableKey, id], queryFn: () => app.history(tableKey, id), retry: false, enabled: rec.isSuccess })
  const profile = useProfile(tableKey)
  const matches = useQuery({ queryKey: ['screens', 'source', tableKey], queryFn: () => app.screens({ source_table: tableKey }), staleTime: 60_000 })
  const timeline = useTimeline(id, profile, hist.data)

  const err = rec.error ?? def.error
  if (err instanceof ApiError && err.status === 404) return <NotFound what="record" />
  if (err instanceof ApiError && err.status === 403) return <PermissionDenied />
  if (err) return <ErrorState requestId={(err as ApiError).requestId} onRetry={() => void rec.refetch()} />
  if (!rec.data || !def.data) return <LoadingState label="Loading record" />

  const table = def.data.table
  const title = String(rec.data.data[table.title_field] ?? table.label)
  return (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <Link to="/records/$table" params={{ table: tableKey }} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> {table.plural_label}
        </Link>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {embedded ? <h2 className="text-lg font-bold text-ink">{title}</h2> : <h1 className="text-xl font-bold text-ink">{title}</h1>}
        <Badge tone="accent">Version {rec.data.version}</Badge>
        <span className="text-xs text-muted">Updated {new Date(rec.data.updated_at).toLocaleString()}</span>
        {rec.data.owner?.name && <span className="text-xs text-muted">Owner: {rec.data.owner.name}</span>}
        <span className="ml-auto hidden gap-2 md:flex">
          {matches.data?.map((m) => (
            <Link key={m.key} to="/match/$screen/$id" params={{ screen: m.key, id }} className="inline-flex items-center gap-1 rounded-md border border-accent bg-accent px-3 py-1.5 text-sm font-semibold text-white hover:bg-accent-strong">
              <Sparkles className="size-4" aria-hidden /> See {m.title.toLowerCase()}
            </Link>
          ))}
          {can(me.data?.permissions, `record.${tableKey}.update`) && (
            <Link to="/records/$table/$id/edit" params={{ table: tableKey, id }} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-soft">
              Edit
            </Link>
          )}
        </span>
      </div>
      {profile && <ProfileSide config={profile} table={table} record={rec.data} timeline={timeline} />}
      <Tabs defaultValue="details">
        <TabsList aria-label="Record sections" className="overflow-x-auto">
          <TabsTrigger value="details">Details</TabsTrigger>
          {relations.data?.map((r) => <TabsTrigger key={r.table} value={`rel-${r.table}-${r.field}`}>{r.label}</TabsTrigger>)}
          <TabsTrigger value="history">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-4">
          <ProfileFields table={table} data={rec.data.data} refs={rec.data.refs} />
        </TabsContent>
        {relations.data?.map((r) => (
          <TabsContent key={`${r.table}-${r.field}`} value={`rel-${r.table}-${r.field}`} className="pt-4">
            <RelatedList id={id} rel={r} canCreate={can(me.data?.permissions, `record.${r.table}.create`)} />
          </TabsContent>
        ))}
        <TabsContent value="history" className="pt-4">
          {hist.isLoading ? (
            <LoadingState label="Loading history" />
          ) : hist.isError ? (
            <ErrorState onRetry={() => void hist.refetch()} />
          ) : (
            <Card className="p-0">
              <Table aria-label="History">
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Who</Th>
                    <Th>What</Th>
                    <Th>App version</Th>
                  </tr>
                </thead>
                <tbody>
                  {timeline.length
                    ? timeline.map((t) => (
                        <tr key={t.key}>
                          <Td>{new Date(t.at).toLocaleString('en-IN')}</Td>
                          <Td>{t.who ?? 'Unknown'}</Td>
                          <Td>{t.link ? <Link to="/records/$table/$id" params={t.link} className="text-accent-ink hover:underline">{t.what}</Link> : t.what}</Td>
                          <Td>{t.version ?? ''}</Td>
                        </tr>
                      ))
                    : [...(hist.data ?? [])].reverse().map((h) => (
                        <tr key={h.seq}>
                          <Td>{new Date(h.at).toLocaleString('en-IN')}</Td>
                          <Td>{h.actor_name ?? 'Unknown'}</Td>
                          <Td>{describe(h.before, h.after)}</Td>
                          <Td>{h.app_version}</Td>
                        </tr>
                      ))}
                </tbody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>
      {!embedded && (
        <nav aria-label="Record actions" className="fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-surface p-2 md:hidden">
          {can(me.data?.permissions, `record.${tableKey}.update`) && (
            <Link to="/records/$table/$id/edit" params={{ table: tableKey, id }} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-line py-2 text-sm font-semibold text-ink">
              <Pencil className="size-4" aria-hidden /> Edit
            </Link>
          )}
          {matches.data?.[0] && (
            <Link to="/match/$screen/$id" params={{ screen: matches.data[0].key, id }} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-accent py-2 text-sm font-semibold text-white">
              <Sparkles className="size-4" aria-hidden /> Matches
            </Link>
          )}
          {profile?.timeline?.[0] && can(me.data?.permissions, `record.${profile.timeline[0].table}.create`) && (
            <Link to="/records/$table/new" params={{ table: profile.timeline[0].table }} search={{ [profile.timeline[0].via]: id }} className="flex flex-1 items-center justify-center gap-1 rounded-md border border-line py-2 text-sm font-semibold text-ink">
              <Plus className="size-4" aria-hidden /> Log
            </Link>
          )}
        </nav>
      )}
      {!embedded && <div className="h-14 md:hidden" aria-hidden />}
    </div>
  )
}

interface Relation { table: string; label: string; field: string; title_field: string; columns: string[] }

/** The records of another table that point at this one (contacts of a client, requirements of a client, ...). */
function RelatedList({ id, rel, canCreate }: { id: string; rel: Relation; canCreate: boolean }) {
  const def = useQuery({ queryKey: ['table', rel.table], queryFn: () => app.table(rel.table) })
  const rows = useQuery({ queryKey: ['related', rel.table, rel.field, id], queryFn: () => app.related(rel.table, rel.field, id) })
  if (rows.isLoading || def.isLoading) return <LoadingState label={`Loading ${rel.label.toLowerCase()}`} />
  if (rows.isError || !def.data) return <ErrorState onRetry={() => void rows.refetch()} />
  const fields = rel.columns.map((c) => def.data.table.fields.find((f) => f.key === c)).filter((f) => !!f && f.key !== rel.field)
  return (
    <div className="flex flex-col gap-3">
      {canCreate && (
        <div>
          <Link to="/records/$table/new" params={{ table: rel.table }} search={{ [rel.field]: id }}>
            <Button variant="secondary" size="sm" type="button">Add {def.data.table.label.toLowerCase()}</Button>
          </Link>
        </div>
      )}
      {rows.data?.items.length ? (
        <Card className="p-0">
          <Table aria-label={rel.label}>
            <thead><tr>{fields.map((f) => <Th key={f!.key}>{f!.label}</Th>)}</tr></thead>
            <tbody>
              {rows.data.items.map((r) => (
                <tr key={r.id}>
                  {fields.map((f, i) => (
                    <Td key={f!.key}>
                      {i === 0 ? <Link to="/records/$table/$id" params={{ table: rel.table, id: r.id }} className="font-semibold text-accent-ink hover:underline">{String(r.data[f!.key] ?? 'Open')}</Link> : formatField(f, r.data[f!.key], r.refs?.[f!.key])}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : (
        <p className="text-sm text-muted">No {rel.label.toLowerCase()} yet.</p>
      )}
    </div>
  )
}
