import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { FieldDef } from '@/api/types'
import { useToast } from '@/design-system'

/** Saves one change to a field in the Draft and refreshes the Studio. */
export function useSaveField(table: string, field: string, what: string) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: Partial<FieldDef>) => studio.updateField(table, field, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['studio-tables'] })
      await qc.invalidateQueries({ queryKey: ['studio-status'] })
    },
    onError: (e) => {
      const msg = e instanceof ApiError && e.errors.length ? e.errors[0]!.message : (e as Error).message
      toast({ title: `Could not save the ${what}`, description: msg, tone: 'bad' })
    },
  })
}
