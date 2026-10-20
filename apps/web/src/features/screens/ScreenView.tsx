import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import type { ScreenConfig } from '@/api/types'
import { ErrorState, LoadingState, NotFound } from '@/design-system'
import { RecordsList } from '@/features/records/RecordsList'
import { MasterDetail } from '@/patterns/MasterDetail'

/** A screen is data: a pattern applied to a table, plus its configuration. This picks the pattern. */
export function ScreenView({ screenKey }: { screenKey: string }) {
  const q = useQuery({ queryKey: ['screen', screenKey], queryFn: () => app.screen(screenKey), retry: false })
  if (q.isLoading) return <LoadingState label="Loading screen" />
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound />
  if (q.error || !q.data) return <ErrorState requestId={(q.error as ApiError | null)?.requestId} onRetry={() => void q.refetch()} />
  const { screen } = q.data
  const config = screen.config as ScreenConfig
  switch (screen.pattern) {
    case 'master_detail':
      return <MasterDetail tableKey={screen.table} title={screen.title} config={config} />
    default:
      return <RecordsList tableKey={screen.table} title={screen.title} config={config} />
  }
}
