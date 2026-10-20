import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, unwrap } from '@/api/client'
import { admin } from '@/api/endpoints'
import { tokens } from '@/api/session'
import { accentShades } from '@/design-system'
import { setRegional } from '@/patterns/format'

export const settingsKey = ['ws-settings'] as const

/** The workspace's branding and regional settings, applied to the app frame (S06, S07). */
export function useBrand() {
  const q = useQuery({ queryKey: settingsKey, queryFn: admin.settings, enabled: !!tokens.get(), staleTime: 60_000, retry: false })
  const brand = q.data?.brand
  if (q.data) setRegional(q.data.regional)
  const logo = useFileUrl(brand?.logo_file_id ?? null)
  return { brand, logo, style: (brand && accentShades(brand.accent)) ?? undefined }
}

/** An object URL for a stored file. The content needs the session token, so it is fetched, not linked. */
export function useFileUrl(id: string | null) {
  const blob = useQuery({
    queryKey: ['file-content', id],
    queryFn: () => unwrap<Blob>(api.GET(`/v1/files/${id}/content` as never, { parseAs: 'blob' } as never) as never),
    enabled: !!id,
    staleTime: Infinity,
    retry: false,
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob.data) return
    const u = URL.createObjectURL(blob.data)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL must be revoked with the blob
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob.data])
  return id ? url : null
}
