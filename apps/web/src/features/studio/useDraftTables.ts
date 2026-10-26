import { useQuery } from '@tanstack/react-query'
import { studio } from '@/api/endpoints'

export function useDraftTables() {
  return useQuery({ queryKey: ['studio-tables'], queryFn: studio.tables, retry: false })
}
