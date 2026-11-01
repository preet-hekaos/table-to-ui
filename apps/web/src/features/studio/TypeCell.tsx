import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import type { FieldDef, StudioTable } from '@/api/types'
import { Badge, useToast } from '@/design-system'
import { Tile, TypePicker } from './TypePicker'
import { buildChoices, currentChoice, type TypeChoice } from './typeCatalog'
import { TYPE_LABELS } from './typeLabels'
import { useTypePresets } from './useTypePresets'

/** The workspace's industry area, named for the picker group ("Recruitment"). */
export function areaLabelOf(areas: string[]): string {
  const a = areas.find((x) => x !== 'common')
  return a ? a.charAt(0).toUpperCase() + a.slice(1) : 'This workspace'
}

/** Type cell of a row in the Fields grid: shows the real-world name and opens the Type picker. */
export function TypeCell({ table, tables, field, canEdit, onAddNew }: { table: StudioTable; tables: StudioTable[]; field: FieldDef; canEdit: boolean; onAddNew: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const presets = useTypePresets()
  const choices = useMemo(() => buildChoices(presets.data, ''), [presets.data])
  const current = currentChoice(choices, field)
  const link = field.ref_table ? ` to ${tables.find((t) => t.key === field.ref_table)?.label ?? field.ref_table}` : ''
  const name = field.type_name ?? TYPE_LABELS[field.type]

  const apply = useMutation({
    mutationFn: (c: TypeChoice) => studio.updateField(table.key, field.key, c.preset ? { preset: c.preset.key } as never : { type: c.core }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['studio-tables'] })
      await qc.invalidateQueries({ queryKey: ['studio-status'] })
    },
    onError: (e) => toast({ title: 'Could not change the type', description: e instanceof ApiError && e.errors.length ? e.errors[0]!.message : (e as Error).message, tone: 'bad' }),
  })
  const allowed = presets.data?.compatible[field.type] ?? [field.type]
  const blocked = (c: TypeChoice) => (allowed.includes(c.core) ? null : `${TYPE_LABELS[field.type].toLowerCase()} values cannot always be read as ${c.name.toLowerCase()}`)

  if (!canEdit || !presets.data)
    return (
      <span className="flex items-center gap-2">
        {current && <Tile text={current.tile} />}
        {name}
        <span className="text-muted">{link}</span>
      </span>
    )
  return (
    <span className="flex items-center gap-1">
      <TypePicker
        choices={choices}
        current={current}
        label={`Type of ${field.label}: ${name}. Change type`}
        blocked={blocked}
        onUse={(c) => apply.mutate(c)}
        onAddNew={onAddNew}
        areaLabel={areaLabelOf((presets.data?.presets ?? []).map((p) => p.area))}
      />
      {link && <span className="text-muted">{link}</span>}
      {apply.isPending && <Badge>Saving</Badge>}
    </span>
  )
}
