import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { studio } from '@/api/endpoints'
import { Button, useToast } from '@/design-system'

/** Brings back a field that was deleted in the Draft and not yet published. */
export function UndoRemove({ table, fieldKey, label }: { table: string; fieldKey: string; label: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const undo = useMutation({
    mutationFn: () => studio.restoreField(table, fieldKey),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['studio-tables'] })
      await qc.invalidateQueries({ queryKey: ['studio-status'] })
      toast({ title: `${label} is back`, tone: 'ok' })
    },
    onError: (e) => toast({ title: `Could not bring back ${label}`, description: (e as Error).message, tone: 'bad' }),
  })
  return (
    <Button size="sm" variant="secondary" className="h-6 px-2 no-underline" onClick={() => undo.mutate()} loading={undo.isPending} aria-label={`Undo delete of ${label}`}>
      Undo
    </Button>
  )
}

/** "12 records have a value here": what a deletion leaves behind, so the cost is clear before publishing. */
export function RemovedCount({ table, fieldKey }: { table: string; fieldKey: string }) {
  const q = useQuery({ queryKey: ['studio-value-count', table, fieldKey], queryFn: () => studio.valueCount(table, fieldKey) })
  if (!q.data) return null
  const n = q.data.count
  return (
    <span className="inline-block text-ink no-underline" data-testid={`removed-count-${fieldKey}`}>
      {n === 0 ? 'No record has a value here.' : `${n} ${n === 1 ? 'record has' : 'records have'} a value here; the values stay stored.`}
    </span>
  )
}
