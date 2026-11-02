import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { useToast } from '@/design-system'
import { featuresOf, type TableFeatures } from './features'

/**
 * The table's features as saved in the Draft, and a way to change some of them at once. Each change saves
 * straight away; changes made quickly one after another build on each other, so none is lost.
 */
export function useTableFeatures(table: StudioTable) {
  const qc = useQueryClient()
  const toast = useToast()
  const saved = featuresOf(table)
  const latest = useRef<TableFeatures>(saved)
  const json = JSON.stringify(saved)
  useEffect(() => {
    latest.current = JSON.parse(json) as TableFeatures
  }, [json])
  const save = useMutation({
    mutationFn: (next: TableFeatures) => studio.setFeatures(table.key, next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['studio-tables'] })
      await qc.invalidateQueries({ queryKey: ['studio-status'] })
    },
    onError: (e) => {
      const first = e instanceof ApiError ? e.errors[0] : undefined
      toast({ title: 'Could not save', description: first ? first.message : (e as Error).message, tone: 'bad' })
    },
  })
  const patch = (change: Partial<TableFeatures>, onFail?: () => void) => {
    latest.current = { ...latest.current, ...change }
    save.mutate(latest.current, { onError: onFail })
  }
  return { features: saved, patch, saving: save.isPending }
}
