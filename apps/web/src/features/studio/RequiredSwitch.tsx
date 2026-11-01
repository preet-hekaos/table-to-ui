import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { FieldDef, StudioTable } from '@/api/types'
import { Switch, useToast } from '@/design-system'

/** Required, as a switch in the Fields grid. One click saves to the Draft; the server says why when it cannot. */
export function RequiredSwitch({ table, field, canEdit }: { table: StudioTable; field: FieldDef; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const save = useMutation({
    mutationFn: (required: boolean) => studio.updateField(table.key, field.key, { required }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['studio-tables'] })
      await qc.invalidateQueries({ queryKey: ['studio-status'] })
    },
    onError: (e) => {
      const msg = e instanceof ApiError && e.errors.length ? e.errors[0]!.message : (e as Error).message
      toast({ title: `Could not make ${field.label} required`, description: msg, tone: 'bad' })
    },
  })
  return (
    <Switch
      label={`${field.label} is required`}
      checked={save.isPending ? !!save.variables : field.required}
      disabled={!canEdit}
      aria-busy={save.isPending || undefined}
      onCheckedChange={(on) => !save.isPending && save.mutate(on)}
    />
  )
}
