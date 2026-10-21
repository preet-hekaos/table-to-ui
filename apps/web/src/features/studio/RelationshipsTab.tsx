import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { studio, type Link, type LinkIssue } from '@/api/endpoints'
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, ErrorState, Field, Input, LoadingState, Select, useToast } from '@/design-system'
import { useDraftTables } from './DataTab'

const refresh = (qc: ReturnType<typeof useQueryClient>) =>
  Promise.all(['studio-relationships', 'studio-tables', 'studio-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
const fieldErrors = (e: unknown) => (e instanceof ApiError ? Object.fromEntries(e.errors.map((x) => [x.field.split('.').pop() ?? x.field, x.message])) : {})

const tone = { problem: 'text-bad', warning: 'text-warn-ink', note: 'text-muted' } as const
const heading = { problem: 'Fix before publishing', warning: 'Worth a look', note: 'Good to know' } as const

/** Plain-words problems with how tables link. Shown here and next to Publish. */
export function LinkHealth({ compact = false }: { compact?: boolean }) {
  const health = useQuery({ queryKey: ['studio-relationships', 'health'], queryFn: studio.linkHealth, retry: false })
  const issues: LinkIssue[] = (health.data ?? []).filter((i) => !compact || i.severity !== 'note')
  if (issues.length === 0) return null
  return (
    <section aria-label={compact ? 'Link health before publishing' : 'Link health'} className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-3 text-sm" data-testid={compact ? 'link-health-publish' : 'link-health'}>
      <p className="font-semibold text-ink">Link health</p>
      <ul className="flex flex-col gap-1">
        {issues.map((i, n) => (
          <li key={n} className={tone[i.severity]}>
            <b>{heading[i.severity]}:</b> {i.message}
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Every link between tables in one place: add, rename, make required, remove. Saved to Draft. */
export function RelationshipsTab({ canEdit, selected, onSelect }: { canEdit: boolean; selected?: string; onSelect: (id: string | undefined) => void }) {
  const links = useQuery({ queryKey: ['studio-relationships'], queryFn: studio.relationships, retry: false })
  const tables = useDraftTables()
  const [adding, setAdding] = useState<'one' | 'many' | null>(null)
  const [editing, setEditing] = useState<Link | null>(null)
  if (links.isError) return <ErrorState requestId={(links.error as ApiError).requestId} onRetry={() => void links.refetch()} />
  if (!links.data || !tables.data) return <LoadingState label="Loading links" />
  const list = links.data
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted">{list.length} links between tables. Changes stay in Draft until you publish.</p>
        {canEdit && (
          <>
            <Button onClick={() => setAdding('one')}>Add a link</Button>
            <Button variant="secondary" onClick={() => setAdding('many')}>Add a many-to-many link</Button>
          </>
        )}
      </div>
      <LinkHealth />
      {list.length === 0 ? (
        <EmptyState title="No links yet" />
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-line" aria-label="Links">
            {list.map((l) => (
              <li key={l.id} className={`flex flex-wrap items-center gap-2 p-3 ${selected === l.id ? 'bg-accent-soft' : ''}`} data-testid={`link-${l.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">
                    {l.table_label} <span className="font-normal text-muted">→</span> {l.to_label}
                  </p>
                  <p className="text-xs text-muted">
                    {l.label}
                    {l.required ? ', required' : ''}
                    {l.hidden ? ', hidden' : ''} · {l.used} {l.used === 1 ? 'record uses' : 'records use'} it
                  </p>
                </div>
                <Badge>{l.source === 'pack' ? 'Comes with the pack' : 'Yours'}</Badge>
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => { onSelect(l.id); setEditing(l) }} aria-label={`Edit link ${l.label} on ${l.table_label}`}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {adding === 'one' && <AddLink onClose={() => setAdding(null)} />}
      {adding === 'many' && <AddMany onClose={() => setAdding(null)} />}
      {editing && <EditLink link={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function useTables() {
  return (useDraftTables().data ?? []).map((t) => ({ key: t.key, label: t.label }))
}

export function AddLink({ onClose, initial }: { onClose: () => void; initial?: { table: string; to: string } }) {
  const qc = useQueryClient()
  const toast = useToast()
  const tables = useTables()
  const [table, setTable] = useState(initial?.table ?? '')
  const [to, setTo] = useState(initial?.to ?? '')
  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const child = tables.find((t) => t.key === table)?.label
  const parent = tables.find((t) => t.key === to)?.label
  const save = useMutation({
    mutationFn: () => studio.addRelationship({ table, to, label: label || undefined, required }),
    onSuccess: async () => {
      toast({ title: 'Link added', description: 'Saved in Draft. Publish to make it live.', tone: 'ok' })
      await refresh(qc)
      onClose()
    },
    onError: (e) => {
      setErrors(fieldErrors(e))
      if (!(e instanceof ApiError) || !e.errors.length) toast({ title: 'Could not add the link', description: (e as Error).message, tone: 'bad' })
    },
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setErrors({})
    save.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a link" description="Each record on the first table points to one record on the second.">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Each…" required error={errors.table}>
            <Select value={table} onChange={(e) => setTable(e.target.value)}>
              <option value="">Choose a table</option>
              {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="…belongs to one" required error={errors.to}>
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose a table</option>
              {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Field label" hint={parent ? `Shown on ${child ?? 'the first table'} as “${label || parent}”.` : undefined} error={errors.label}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={parent ?? ''} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
          </label>
          {child && parent && <p className="text-sm text-muted">Each {child} belongs to one {parent}. The {parent} page will list its {child} records.</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!table || !to || save.isPending}>Add link</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AddMany({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const tables = useTables()
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => studio.addManyToMany({ a, b }),
    onSuccess: async (r) => {
      toast({ title: `Added ${r.label}`, description: 'Saved in Draft. Publish to make it live.', tone: 'ok' })
      await refresh(qc)
      onClose()
    },
    onError: (e) => {
      setErrors(fieldErrors(e))
      if (!(e instanceof ApiError) || !e.errors.length) toast({ title: 'Could not add the link', description: (e as Error).message, tone: 'bad' })
    },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add a many-to-many link" description="Many records of one table can link to many records of another. A small linking table holds each pair.">
        <form onSubmit={(e) => { e.preventDefault(); setErrors({}); save.mutate() }} className="flex flex-col gap-4" noValidate>
          <Field label="First table" required error={errors.a}>
            <Select value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">Choose a table</option>
              {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Second table" required error={errors.b}>
            <Select value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">Choose a table</option>
              {tables.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!a || !b || save.isPending}>Add link</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function EditLink({ link, onClose }: { link: Link; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [label, setLabel] = useState(link.label)
  const [help, setHelp] = useState(link.help ?? '')
  const [required, setRequired] = useState(link.required)
  const [hidden, setHidden] = useState(link.hidden)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const isPack = link.source === 'pack'
  const done = async (title: string) => {
    toast({ title, description: 'Saved in Draft. Publish to make it live.', tone: 'ok' })
    await refresh(qc)
    onClose()
  }
  const save = useMutation({
    mutationFn: () => studio.updateField(link.table, link.field, { label, help: help || null, hidden, ...(isPack ? {} : { required }) }),
    onSuccess: () => done(`Saved ${label}`),
    onError: (e) => setErrors(fieldErrors(e)),
  })
  const remove = useMutation({
    mutationFn: () => studio.removeRelationship(link.table, link.field),
    onSuccess: () => done(`Removed ${link.label}`),
    onError: (e) => toast({ title: 'Could not remove the link', description: (e as Error).message, tone: 'bad' }),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Edit ${link.label}`}
        description={isPack ? 'This link comes with the pack. You can rename it or hide it; it cannot be deleted.' : `${link.table_label} → ${link.to_label}. The table it points to cannot change; add a new link instead.`}
      >
        <form onSubmit={(e) => { e.preventDefault(); setErrors({}); save.mutate() }} className="flex flex-col gap-4" noValidate>
          <Field label="Label" required error={errors.label}>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
          </Field>
          <Field label="Help text" error={errors.help}>
            <Input value={help} onChange={(e) => setHelp(e.target.value)} />
          </Field>
          {!isPack && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
            </label>
          )}
          {!isPack && required && !link.required && link.empty > 0 && (
            <p className="text-xs text-warn-ink">
              {link.empty} of {link.total} existing records have no {link.label}. They keep working, but will need one the next time someone edits them.
            </p>
          )}
          {errors.required && <p role="alert" className="text-xs text-bad">{errors.required}</p>}
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Hide from screens
          </label>
          {errors.hidden && <p role="alert" className="text-xs text-bad">{errors.hidden}</p>}
          <div className="flex flex-wrap justify-between gap-2">
            {!isPack ? (
              <Button type="button" variant="secondary" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove link</Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!label.trim() || save.isPending}>Save</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
