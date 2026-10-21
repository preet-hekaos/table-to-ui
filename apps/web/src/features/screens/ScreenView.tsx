import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { app, search } from '@/api/endpoints'
import type { ScreenConfig } from '@/api/types'
import { ErrorState, LoadingState, NotFound } from '@/design-system'
import { RecordsList } from '@/features/records/RecordsList'
import { Board } from '@/features/board/Board'
import { DuplicateReview } from '@/features/duplicates/Duplicates'
import { DocumentReview } from '@/patterns/DocumentReview'
import { MasterDetail } from '@/patterns/MasterDetail'

/** A screen is data: a pattern applied to a table, plus its configuration. This picks the pattern. */
export function ScreenView({ screenKey, saved, filter }: { screenKey: string; saved?: string; filter?: { ref: string; id: string } }) {
  const q = useQuery({ queryKey: ['screen', screenKey], queryFn: () => app.screen(screenKey), retry: false })
  const searches = useQuery({ queryKey: ['saved-searches'], queryFn: search.saved, enabled: !!saved })
  if (q.isLoading || (saved && searches.isLoading)) return <LoadingState label="Loading screen" />
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound />
  if (q.error || !q.data) return <ErrorState requestId={(q.error as ApiError | null)?.requestId} onRetry={() => void q.refetch()} />
  const { screen } = q.data
  const config = screen.config as ScreenConfig
  switch (screen.pattern) {
    case 'document_review':
      return <DocumentReview key={screen.key} screenKey={screen.key} tableKey={screen.table} title={screen.title} config={config} />
    case 'board':
      return <Board key={screen.key} tableKey={screen.table} title={screen.title} filter={filter} />
    case 'duplicate_review':
      return <DuplicateReview tableKey={screen.table} title={screen.title} />
    case 'master_detail':
      return <MasterDetail tableKey={screen.table} title={screen.title} config={config} />
    default: {
      const initial = searches.data?.find((x) => x.id === saved)?.query
      return <RecordsList key={saved ?? 'all'} tableKey={screen.table} title={screen.title} config={config} screenKey={screen.key} initial={initial} />
    }
  }
}
