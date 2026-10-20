import { useQuery } from '@tanstack/react-query'
import { auth } from '@/api/endpoints'
import { tokens } from '@/api/session'

export const meKey = ['me'] as const

export function useMe() {
  return useQuery({
    queryKey: meKey,
    queryFn: auth.me,
    enabled: !!tokens.get(),
    retry: false,
    staleTime: 60_000,
  })
}

export const can = (permissions: string[] | undefined, p: string) => !!permissions?.includes(p)
