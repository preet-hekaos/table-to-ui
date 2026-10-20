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

/** Exact grant or a wildcard grant such as `*` or `record.*.read`, matching the server's rule. */
export const can = (permissions: string[] | undefined, p: string) =>
  !!permissions?.some((g) => {
    if (g === p) return true
    if (!g.includes('*')) return false
    const re = new RegExp('^' + g.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
    return re.test(p)
  })
