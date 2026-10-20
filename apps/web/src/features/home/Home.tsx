import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import { Card, EmptyState, ErrorState, LoadingState } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'

/** Home: governed measure cards. Values come from the analytics store, never from live tables. */
export function Home() {
  const me = useMe()
  const measures = useQuery({
    queryKey: ['measures'],
    queryFn: app.measures,
    enabled: !!me.data,
    retry: false,
    refetchInterval: 15_000,
  })
  if (!me.data) return null
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
            'Ask your agency admin to publish it.'
          )}
        </EmptyState>
      ) : measures.error ? (
        <ErrorState requestId={(measures.error as ApiError).requestId} onRetry={() => void measures.refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {measures.data?.map((m) => (
            <Card key={m.key} data-testid={`measure-${m.key}`}>
              <p className="text-xs font-semibold text-muted">{m.label}</p>
              <p className="mt-1 text-3xl font-bold text-ink" aria-label={`${m.label}: ${m.value}`}>{m.value}</p>
              <p className="mt-1 text-xs text-muted">{m.as_of ? `As of ${new Date(m.as_of).toLocaleTimeString()}` : 'No data yet'}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
