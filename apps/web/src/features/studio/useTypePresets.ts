import { useQuery } from '@tanstack/react-query'
import { studio } from '@/api/endpoints'

/** The types a builder can pick, ranked by how often this workspace uses them. Refreshes with every Studio change. */
export function useTypePresets() {
  return useQuery({ queryKey: ['studio-status', 'type-presets'], queryFn: studio.typePresets, staleTime: 10_000 })
}
