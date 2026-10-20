import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import { EmptyState, ErrorState, LoadingState, PermissionDenied, Table, Td, Th } from '@/design-system'

/** The agency's activity log: who did what and when. */
export function Activity() {
  const log = useQuery({ queryKey: ['activity'], queryFn: app.activity, retry: false })
  if (log.error instanceof ApiError && log.error.status === 403) return <PermissionDenied />
  if (log.isLoading) return <LoadingState label="Loading activity" />
  if (log.isError) return <ErrorState requestId={(log.error as ApiError).requestId} onRetry={() => void log.refetch()} />
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Activity</h1>
      {log.data?.length ? (
        <Table aria-label="Activity">
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>What</Th>
            </tr>
          </thead>
          <tbody>
            {log.data.map((r) => (
              <tr key={r.id}>
                <Td>{new Date(r.at).toLocaleString()}</Td>
                <Td>{r.actor ?? 'System'}</Td>
                <Td>{r.action}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="Nothing has happened yet">Changes made by your team appear here.</EmptyState>
      )}
    </div>
  )
}
