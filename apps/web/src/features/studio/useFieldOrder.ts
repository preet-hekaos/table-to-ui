import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { studio } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { useToast } from '@/design-system'

/** Moves a field to a new place and saves the order to the Draft; shows the new order at once and puts it back if the save fails. */
export function useFieldOrder(table: StudioTable) {
  const qc = useQueryClient()
  const toast = useToast()
  const [note, setNote] = useState('')
  const save = useMutation({
    mutationFn: (order: string[]) => studio.reorderFields(table.key, order),
    onMutate: async (order) => {
      await qc.cancelQueries({ queryKey: ['studio-tables'] })
      const before = qc.getQueryData<StudioTable[]>(['studio-tables'])
      qc.setQueryData<StudioTable[]>(['studio-tables'], (all) =>
        all?.map((t) => (t.key === table.key ? { ...t, fields: order.map((k) => t.fields.find((f) => f.key === k)!) } : t)),
      )
      return { before }
    },
    onError: (e, _o, ctx) => {
      qc.setQueryData(['studio-tables'], ctx?.before)
      toast({ title: 'Could not save the order', description: (e as Error).message, tone: 'bad' })
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['studio-tables'] })
      await qc.invalidateQueries({ queryKey: ['studio-status'] })
    },
  })
  const keys = table.fields.map((f) => f.key)
  /** Put `key` at index `to` (counted among the fields). */
  const move = (key: string, to: number) => {
    const from = keys.indexOf(key)
    const target = Math.max(0, Math.min(keys.length - 1, to))
    if (from < 0 || from === target) return
    const next = keys.filter((k) => k !== key)
    next.splice(target, 0, key)
    const label = table.fields.find((f) => f.key === key)!.label
    setNote(`${label} moved to position ${target + 1} of ${keys.length}`)
    save.mutate(next)
  }
  return { move, note }
}
