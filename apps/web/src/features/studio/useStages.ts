import { useQuery } from '@tanstack/react-query'
import { studio, type StageKind } from '@/api/endpoints'
import type { Stage } from '@/design-system'

/** The stage of every item in the Draft. The key starts with "studio-status", so every Studio change refreshes it. */
export function useStages() {
  const q = useQuery({ queryKey: ['studio-status', 'stages'], queryFn: studio.stages, retry: false, staleTime: 5_000 })
  const data = q.data
  return {
    ready: !!data,
    report: data,
    of: (kind: StageKind, key: string): Stage | undefined => data?.items[kind]?.[key]?.stage,
    isNew: (kind: StageKind, key: string): boolean => !!data?.items[kind]?.[key]?.is_new,
    removedFields: (table: string) => data?.items.tables?.[table]?.removed_fields ?? [],
    field: (table: string, field: string): Stage | undefined => data?.items.tables?.[table]?.fields?.[field],
  }
}
