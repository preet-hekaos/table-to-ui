import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import { Badge, Card, ErrorState, LoadingState, NotFound, PermissionDenied, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th } from '@/design-system'
import { ProfileFields } from '@/patterns/ProfilePage'

function describe(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before) return 'Created'
  const changed = Object.keys(after ?? {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify((after ?? {})[k]))
  return changed.length ? `Changed ${changed.join(', ')}` : 'Saved with no changes'
}

/** Thin 3.5: one record with its fields grouped as the pack defines them, and its history. */
export function RecordDetail({ tableKey, id }: { tableKey: string; id: string }) {
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const rec = useQuery({ queryKey: ['record', tableKey, id], queryFn: () => app.get(tableKey, id), retry: false })
  const hist = useQuery({ queryKey: ['history', tableKey, id], queryFn: () => app.history(tableKey, id), retry: false, enabled: rec.isSuccess })

  const err = rec.error ?? def.error
  if (err instanceof ApiError && err.status === 404) return <NotFound what="record" />
  if (err instanceof ApiError && err.status === 403) return <PermissionDenied />
  if (err) return <ErrorState requestId={(err as ApiError).requestId} onRetry={() => void rec.refetch()} />
  if (!rec.data || !def.data) return <LoadingState label="Loading record" />

  const table = def.data.table
  const title = String(rec.data.data[table.title_field] ?? table.label)
  return (
    <div className="flex flex-col gap-4">
      <Link to="/records/$table" params={{ table: tableKey }} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {table.plural_label}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        <Badge tone="accent">Version {rec.data.version}</Badge>
        <span className="text-xs text-muted">Updated {new Date(rec.data.updated_at).toLocaleString()}</span>
      </div>
      <Tabs defaultValue="details">
        <TabsList aria-label="Record sections">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="details" className="pt-4">
          <ProfileFields table={table} data={rec.data.data} />
        </TabsContent>
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
                  {hist.data?.map((h) => (
                    <tr key={h.seq}>
                      <Td>{new Date(h.at).toLocaleString()}</Td>
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
    </div>
  )
}
