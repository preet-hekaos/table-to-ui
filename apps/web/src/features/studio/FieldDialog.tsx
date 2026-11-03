import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { ai, studio } from '@/api/endpoints'
import type { FieldDef, StudioTable } from '@/api/types'
import { Button, Dialog, DialogContent, Field, SideContent, Input, Select, useToast } from '@/design-system'

export { TYPE_LABELS } from './typeLabels'
import { TYPE_LABELS } from './typeLabels'
import { areaLabelOf } from './TypeCell'
import { ExplainPanel } from './ExplainPanel'
import { FieldWordsPanel } from './FieldWordsPanel'
import { TypePicker } from './TypePicker'
import { buildChoices, type TypeChoice } from './typeCatalog'
import { useTypePresets } from './useTypePresets'

const fieldErrors = (e: unknown) =>
  e instanceof ApiError ? Object.fromEntries(e.errors.map((x) => [x.field.split('.').pop() ?? x.field, x.message])) : {}

interface Props {
  table: StudioTable
  tables: StudioTable[]
  field?: FieldDef
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Add a field (any business type) or change one. Every field, pack or not, is edited the same way. */
export function FieldDialog({ table, tables, field, open, onOpenChange }: Props) {
  const qc = useQueryClient()
  const toast = useToast()
  const isNew = !field
  const [explaining, setExplaining] = useState(false)
  const [label, setLabel] = useState(field?.label ?? '')
  const presets = useTypePresets()
  const aiSetting = useQuery({ queryKey: ['ai', 'settings'], queryFn: ai.settings, staleTime: 60_000, retry: false, enabled: isNew })
  const choices = useMemo(() => buildChoices(presets.data, ''), [presets.data])
  const [picked, setPicked] = useState<TypeChoice | undefined>()
  const chosen = picked ?? choices.find((c) => c.id === 'core:text')
  const type: FieldDef['type'] = isNew ? (chosen?.core ?? 'text') : field.type
  const [options, setOptions] = useState((field?.options ?? []).join(', '))
  const [refTable, setRefTable] = useState(field?.ref_table ?? '')
  const [required, setRequired] = useState(field?.required ?? false)
  const [unique, setUnique] = useState(field?.unique ?? false)
  const [hidden, setHidden] = useState(field?.hidden ?? false)
  const [help, setHelp] = useState(field?.help ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const done = async (title: string) => {
    toast({ title, description: 'Saved in Draft. Publish to make it live.', tone: 'ok' })
    await qc.invalidateQueries({ queryKey: ['studio-tables'] })
    await qc.invalidateQueries({ queryKey: ['studio-status'] })
    onOpenChange(false)
  }
  const save = useMutation({
    mutationFn: () => {
      const opts = options.split(',').map((x) => x.trim()).filter(Boolean)
      if (isNew)
        return studio.addField(table.key, {
          label,
          type,
          ...(chosen?.preset ? ({ preset: chosen.preset.key } as object) : {}),
          required,
          unique,
          help: help || null,
          ...(type === 'select' || type === 'tags' ? { options: opts } : {}),
          ...(type === 'reference' ? { ref_table: refTable } : {}),
        })
      const body: Partial<FieldDef> = { label, help: help || null, hidden }
      Object.assign(body, { required, ...(type === 'select' ? { options: opts } : {}) })
      return studio.updateField(table.key, field.key, body)
    },
    onSuccess: () => done(isNew ? `Added ${label}` : `Saved ${label}`),
    onError: (e) => {
      setErrors(fieldErrors(e))
      if (!(e instanceof ApiError) || !e.errors.length) toast({ title: 'Could not save', description: (e as Error).message, tone: 'bad' })
    },
  })
  const remove = useMutation({
    mutationFn: () => studio.removeField(table.key, field!.key),
    onSuccess: () => done(`Removed ${field!.label}`),
    onError: (e) => toast({ title: 'Could not remove', description: (e as Error).message, tone: 'bad' }),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    save.mutate()
  }
  const textual = ['text', 'email', 'phone'].includes(type)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SideContent
        title={isNew ? `Add a field to ${table.label}` : `Edit ${field.label}`}
        description={
          isNew ? 'New fields are searchable and can be used as filters. They stay in Draft until you publish.' : undefined
        }
        footer={
          <>
            {!isNew && (
              <Button type="button" variant="danger" onClick={() => remove.mutate()} loading={remove.isPending}>
                Delete field
              </Button>
            )}
            <span className="flex-1" />
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="field-form" variant="primary" loading={save.isPending}>
              {isNew ? 'Add field' : 'Save'}
            </Button>
          </>
        }
      >
        <form id="field-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {!isNew && (
            <div className="-mt-1 flex">
              <Button type="button" size="sm" variant="secondary" className="text-violet-800" onClick={() => setExplaining(true)}>
                <Sparkles className="size-3.5" aria-hidden /> Explain this field
              </Button>
            </div>
          )}
          {isNew && (
            <FieldWordsPanel
              aiOn={!!aiSetting.data?.enabled}
              onUse={(p) => {
                setLabel(p.label)
                setPicked(choices.find((c) => c.id === (p.preset ? `preset:${p.preset}` : `core:${p.type}`)))
                setRequired(p.required)
                setOptions(p.options.join(', '))
              }}
            />
          )}
          <Field label="Label" required error={errors.label ?? errors.key}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <Field label="Type" error={errors.type}>
            {isNew && presets.data ? (
              <span className="flex items-center gap-2">
                <TypePicker
                  choices={choices}
                  current={chosen}
                  label={`Type: ${chosen?.name ?? 'Short text'}. Change type`}
                  onUse={setPicked}
                  areaLabel={areaLabelOf(presets.data.presets.map((p) => p.area))}
                />
              </span>
            ) : (
              <Select value={type} disabled onChange={() => undefined}>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {(type === 'select' || type === 'tags') && (
            <Field label="Choices" hint="Separate with commas" error={errors.options}>
              <Input value={options} onChange={(e) => setOptions(e.target.value)} />
            </Field>
          )}
          {type === 'reference' && isNew && (
            <Field label="Links to" required error={errors.ref_table}>
              <Select value={refTable} onChange={(e) => setRefTable(e.target.value)}>
                <option value="">Choose a table</option>
                {tables.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Help text" hint="Shown under the field on forms" error={errors.help}>
            <Input value={help} onChange={(e) => setHelp(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-2 text-sm text-ink">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
            </label>
            {isNew && textual && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} /> No two records may share a value
              </label>
            )}
            {!isNew && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide from screens
              </label>
            )}
            {errors.hidden && (
              <p role="alert" className="text-xs font-medium text-bad-ink">
                {errors.hidden}
              </p>
            )}
            {errors.field && (
              <p role="alert" className="text-xs font-medium text-bad-ink">
                {errors.field}
              </p>
            )}
          </div>
        </form>
      </SideContent>
      {explaining && field && <ExplainPanel table={table} tables={tables} field={field} canEdit={false} onClose={() => setExplaining(false)} onEdit={() => undefined} />}
    </Dialog>
  )
}

export function NewTableDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (key: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [label, setLabel] = useState('')
  const [plural, setPlural] = useState('')
  const [titleLabel, setTitleLabel] = useState('Name')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const create = useMutation({
    mutationFn: () => studio.createTable({ label, plural_label: plural || undefined, title_label: titleLabel }),
    onSuccess: async (t) => {
      toast({ title: `Created ${t.label}`, description: 'It has a list screen and a menu entry in Draft.', tone: 'ok' })
      await Promise.all(['studio-tables', 'studio-status', 'studio-nav', 'studio-screens'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      onOpenChange(false)
      onCreated(t.key)
    },
    onError: (e) => setErrors(fieldErrors(e)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="New table" description="A table holds one kind of record, such as suppliers or referral partners.">
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            setErrors({})
            create.mutate()
          }}
        >
          <Field label="Name of one record" hint="For example: Referral partner" required error={errors.label ?? errors.key}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <Field label="Name of many records" hint={label ? `Leave empty for "${label}s"` : 'For example: Referral partners'}>
            <Input value={plural} onChange={(e) => setPlural(e.target.value)} />
          </Field>
          <Field label="Label of the name field" hint="Every record has a name that is shown in lists and links">
            <Input value={titleLabel} onChange={(e) => setTitleLabel(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create table
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
