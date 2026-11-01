import { useMutation, useQueryClient } from '@tanstack/react-query'
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
