import { useQuery } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { app, search } from '@/api/endpoints'
import type { ScreenConfig } from '@/api/types'
import { EmptyState, ErrorState, Field, LoadingState, NotFound, Select } from '@/design-system'
import { useState } from 'react'
import { RecordNew } from '@/features/records/RecordNew'
import { RankedList } from '@/patterns/RankedList'
import { RecordsList } from '@/features/records/RecordsList'
import { Board } from '@/features/board/Board'
import { DuplicateReview } from '@/features/duplicates/Duplicates'
import { DocumentReview } from '@/patterns/DocumentReview'
import { MasterDetail } from '@/patterns/MasterDetail'

/** A ranked-list screen needs a record to rank against: pick one (for example a requirement), then see the order. */
function RankedPicker({ screenKey, title, sourceTable }: { screenKey: string; title: string; sourceTable: string }) {
  const def = useQuery({ queryKey: ['table', sourceTable], queryFn: () => app.table(sourceTable), retry: false })
  const list = useQuery({ queryKey: ['records', sourceTable, 'ranked-source'], queryFn: () => app.list(sourceTable, { limit: 100 }), retry: false })
  const [picked, setPicked] = useState('')
  if (def.error || list.error) return <ErrorState onRetry={() => void list.refetch()} />
  if (!def.data || !list.data) return <LoadingState label="Loading" />
  const t = def.data.table
  const items = list.data.items
  const current = picked || items[0]?.id || ''
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">{title}</h1>
      {items.length === 0 ? (
        <EmptyState title={`No ${t.plural_label.toLowerCase()} yet`}>Add one first; its matches are ranked here.</EmptyState>
      ) : (
        <>
          <div className="w-72">
            <Field label={`Rank against ${t.label.toLowerCase()}`}>
              <Select value={current} onChange={(e) => setPicked(e.target.value)}>
                {items.map((r) => <option key={r.id} value={r.id}>{String(r.data[t.title_field] ?? 'Untitled')}</option>)}
              </Select>
            </Field>
          </div>
          <RankedList key={current} screenKey={screenKey} sourceId={current} />
        </>
      )}
    </div>
  )
}

/** A screen is data: a pattern applied to a table, plus its configuration. This picks the pattern. */
export function ScreenView({ screenKey, saved, filter }: { screenKey: string; saved?: string; filter?: { ref: string; id: string } }) {
  const q = useQuery({ queryKey: ['screen', screenKey], queryFn: () => app.screen(screenKey), retry: false })
  const nav = useQuery({ queryKey: ['navigation'], queryFn: app.navigation, retry: false })
  const searches = useQuery({ queryKey: ['saved-searches'], queryFn: search.saved, enabled: !!saved })
  if (q.isLoading || (saved && searches.isLoading)) return <LoadingState label="Loading screen" />
  if (q.error instanceof ApiError && q.error.status === 404) return <NotFound />
  if (q.error || !q.data) return <ErrorState requestId={(q.error as ApiError | null)?.requestId} onRetry={() => void q.refetch()} />
  // The menu item is the name people know the screen by, so the page heading follows it.
  const label = nav.data?.items.find((i) => i.screen === screenKey)?.label
  const screen = label ? { ...q.data.screen, title: label } : q.data.screen
  const config = screen.config as ScreenConfig
  switch (screen.pattern) {
    case 'document_review':
      if (!(config as { parser?: string }).parser) {
        return <EmptyState title="This screen is not set up yet">A document screen needs a reader and a map from what it finds to the table’s fields. Start from the pack’s “Add from CV” screen.</EmptyState>
      }
      return <DocumentReview key={screen.key} screenKey={screen.key} tableKey={screen.table} title={screen.title} config={config} />
    case 'board':
      return <Board key={screen.key} tableKey={screen.table} title={screen.title} filter={filter} />
    case 'duplicate_review':
      return <DuplicateReview tableKey={screen.table} title={screen.title} />
    case 'master_detail':
    case 'profile':
    case 'detail':
      // A list beside the chosen record, which already shows every field in groups with its related tabs and timeline.
      return <MasterDetail tableKey={screen.table} title={screen.title} config={config} />
    case 'form':
      return (
        <div className="flex flex-col gap-4">
          <h1 className="text-xl font-bold text-ink">{screen.title}</h1>
          <RecordNew tableKey={screen.table} />
        </div>
      )
    case 'ranked_list': {
      const source = (config as { source_table?: string }).source_table
      if (!source) {
        return <EmptyState title="Choose what to rank against">Open this screen in the Studio and set its source table. Matches are ranked for one record of that table.</EmptyState>
      }
      return <RankedPicker screenKey={screen.key} title={screen.title} sourceTable={source} />
    }
    default: {
      const initial = searches.data?.find((x) => x.id === saved)?.query
      return <RecordsList key={saved ?? 'all'} tableKey={screen.table} title={screen.title} config={config} screenKey={screen.key} initial={initial} />
    }
  }
}
