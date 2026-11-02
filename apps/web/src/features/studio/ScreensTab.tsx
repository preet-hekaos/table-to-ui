import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import { app, studio, type DraftScreen } from '@/api/endpoints'
import type { RecordRow, ScreenConfig, StudioTable } from '@/api/types'
import { Badge, Button, Card, ErrorState, Field, Input, LoadingState, Select, StageBadge, cn, useToast } from '@/design-system'
import { useStages } from './useStages'
import { RecordsList } from '@/features/records/RecordsList'
import { MasterDetail } from '@/patterns/MasterDetail'
import { useDraftTables } from './useDraftTables'

export const PATTERNS = [
  { key: 'searchable_table', name: 'Searchable table', use: 'Find, sort and filter many records.' },
  { key: 'master_detail', name: 'Master-detail', use: 'A list beside the chosen record and its related tabs.' },
  { key: 'profile', name: 'Profile', use: 'Everything about one record on one page, with a timeline.' },
  { key: 'detail', name: 'Detail', use: 'A record’s fields in labelled groups.' },
  { key: 'form', name: 'Form', use: 'Add or change one record with checks as you type.' },
  { key: 'ranked_list', name: 'Ranked list', use: 'Records in score order with the reasons shown.' },
  { key: 'document_review', name: 'Document review', use: 'A document beside the details read from it.' },
] as const

// Export and Import are switched per table in Features, so this screen only decides whether it offers Add.
const ACTIONS = [['create', 'Add']] as const

/** A thumbnail of a pattern drawn with the workspace's own records (S15 AC1). */
function Thumb({ pattern, table, rows }: { pattern: string; table?: StudioTable; rows: RecordRow[] }) {
  const title = (r: RecordRow) => String(r.data[table?.title_field ?? ''] ?? '—')
  const names = rows.length ? rows.slice(0, 3).map(title) : [`First ${table?.label.toLowerCase() ?? 'record'}`, 'Second', 'Third']
  const fields = (table?.fields ?? []).filter((f) => !f.hidden).slice(1, 4)
  const bar = 'h-1.5 rounded bg-line'
  const box = 'h-24 overflow-hidden rounded-md border border-line bg-canvas p-2 text-[10px] leading-tight text-body'
  switch (pattern) {
    case 'master_detail':
      return (
        <div className={cn(box, 'grid grid-cols-[40%_1fr] gap-2')}>
          <div className="flex flex-col gap-1">{names.map((n, i) => <span key={i} className={cn('truncate rounded px-1', i === 0 && 'bg-accent-soft text-accent-ink')}>{n}</span>)}</div>
          <div className="flex flex-col gap-1"><b className="text-ink">{names[0]}</b>{fields.map((f) => <span key={f.key} className="truncate text-muted">{f.label}</span>)}</div>
        </div>
      )
    case 'profile':
    case 'detail':
      return (
        <div className={box}>
          <b className="text-ink">{names[0]}</b>
          {fields.map((f) => <div key={f.key} className="flex justify-between gap-2"><span className="text-muted">{f.label}</span><span className="truncate">{String(rows[0]?.data[f.key] ?? '')}</span></div>)}
          {pattern === 'profile' && <div className="mt-1 flex flex-col gap-1"><span className={bar} /><span className={cn(bar, 'w-2/3')} /></div>}
        </div>
      )
    case 'form':
      return (
        <div className={cn(box, 'flex flex-col gap-1')}>
          {(table?.fields ?? []).slice(0, 3).map((f) => <span key={f.key} className="flex flex-col"><span className="text-muted">{f.label}</span><span className="h-2.5 rounded border border-line bg-surface" /></span>)}
        </div>
      )
    case 'ranked_list':
      return (
        <div className={cn(box, 'flex flex-col gap-1.5')}>
          {names.map((n, i) => <span key={i} className="flex items-center gap-2"><span className="w-4 text-muted">{i + 1}</span><span className="w-20 truncate">{n}</span><span className="h-1.5 flex-1 rounded bg-accent-soft"><span className="block h-full rounded bg-accent" style={{ width: `${90 - i * 20}%` }} /></span></span>)}
        </div>
      )
    case 'document_review':
      return (
        <div className={cn(box, 'grid grid-cols-2 gap-2')}>
          <div className="flex flex-col gap-1 rounded border border-line bg-surface p-1"><span className={bar} /><span className={bar} /><span className={cn(bar, 'w-1/2')} /></div>
          <div className="flex flex-col gap-1">{fields.map((f) => <span key={f.key} className="truncate"><span className="text-muted">{f.label}:</span> {String(rows[0]?.data[f.key] ?? '…')}</span>)}</div>
        </div>
      )
    default:
      return (
        <div className={box}>
          <div className="flex gap-2 border-b border-line pb-1 font-semibold text-ink">{(table?.fields ?? []).slice(0, 3).map((f) => <span key={f.key} className="w-1/3 truncate">{f.label}</span>)}</div>
          {rows.slice(0, 3).map((r) => <div key={r.id} className="flex gap-2 py-0.5">{(table?.fields ?? []).slice(0, 3).map((f) => <span key={f.key} className="w-1/3 truncate">{String(r.data[f.key] ?? '')}</span>)}</div>)}
          {rows.length === 0 && names.map((n, i) => <div key={i} className="py-0.5">{n}</div>)}
        </div>
      )
  }
}

/** Screen 2.7: the pattern gallery. Choosing a pattern and a table creates a screen in Draft. */
function Gallery({ tables, onCreated }: { tables: StudioTable[]; onCreated: (key: string) => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [tableKey, setTableKey] = useState(tables[0]?.key ?? '')
  const table = tables.find((t) => t.key === tableKey)
  const sample = useQuery({ queryKey: ['records', tableKey, 'sample'], queryFn: () => app.list(tableKey, { limit: 3 }), retry: false, enabled: !!tableKey })
  const create = useMutation({
    mutationFn: (pattern: string) => {
      const p = PATTERNS.find((x) => x.key === pattern)!
      const key = `${tableKey}_${pattern}`.slice(0, 60)
      return studio.saveScreen(key, { title: `${table?.plural_label ?? tableKey} (${p.name.toLowerCase()})`, pattern, table: tableKey, config: {}, roles: [] })
    },
    onSuccess: async (s) => {
      toast({ title: `Created ${s.title}`, description: 'Tune it below, then add it to the menu.', tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['studio-screens'] })
      onCreated(s.key)
    },
    onError: (e) => toast({ title: 'Could not create the screen', description: e.message, tone: 'bad' }),
  })
  return (
    <Card>
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-base font-bold text-ink">Pattern gallery</h2>
        <div className="ml-auto w-56">
          <Field label="Show it with">
            <Select value={tableKey} onChange={(e) => setTableKey(e.target.value)}>
              {tables.map((t) => <option key={t.key} value={t.key}>{t.plural_label}</option>)}
            </Select>
          </Field>
        </div>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Patterns">
        {PATTERNS.map((p) => (
          <li key={p.key} className="flex flex-col gap-2 rounded-lg border border-line p-3" data-testid={`pattern-${p.key}`}>
            <Thumb pattern={p.key} table={table} rows={sample.data?.items ?? []} />
            <h3 className="text-sm font-bold text-ink">{p.name}</h3>
            <p className="text-xs text-muted">{p.use}</p>
            <Button size="sm" className="mt-auto" onClick={() => create.mutate(p.key)} loading={create.isPending && create.variables === p.key} aria-label={`Use ${p.name} for ${table?.plural_label ?? ''}`}>
              Use this pattern
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Checklist({ legend, options, value, onChange }: { legend: string; options: { key: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-xs font-semibold text-ink">{legend}</legend>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border border-line p-2">
        {options.map((o) => (
          <label key={o.key} className="flex items-center gap-2 text-sm text-body">
            <input type="checkbox" checked={value.includes(o.key)} onChange={(e) => onChange(e.target.checked ? [...value, o.key] : value.filter((x) => x !== o.key))} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Screen 2.8: the configurator. Every change redraws the preview at once (S15 AC2). */
function Configurator({ screen, table, canEdit }: { screen: DraftScreen; table: StudioTable; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [title, setTitle] = useState(screen.title)
  const [cfg, setCfg] = useState<ScreenConfig>(screen.config as ScreenConfig)
  const fields = table.fields.filter((f) => !f.hidden).map((f) => ({ key: f.key, label: f.label }))
  const set = (patch: Partial<ScreenConfig>) => setCfg((c) => ({ ...c, ...patch }))
  const save = useMutation({
    mutationFn: () => studio.saveScreen(screen.key, { title, pattern: screen.pattern, table: screen.table, config: cfg as Record<string, unknown>, roles: screen.roles }),
    onSuccess: async () => {
      toast({ title: `Saved ${title} in Draft`, tone: 'ok' })
      await Promise.all([qc.invalidateQueries({ queryKey: ['studio-screens'] }), qc.invalidateQueries({ queryKey: ['studio-status'] })])
    },
    onError: (e) => toast({ title: 'Could not save the screen', description: e.message, tone: 'bad' }),
  })
  const listLike = screen.pattern === 'searchable_table' || screen.pattern === 'master_detail' || screen.pattern === 'ranked_list'
  const dirty = title !== screen.title || JSON.stringify(cfg) !== JSON.stringify(screen.config)
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <Card className="flex flex-col gap-4" aria-label="Screen settings">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold text-ink">Configure</h2>
          <Badge tone="accent">{PATTERNS.find((p) => p.key === screen.pattern)?.name ?? screen.pattern}</Badge>
        </div>
        <Field label="Title" hint="The heading at the top of the page. The menu name is set in Menu.">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!canEdit} />
        </Field>
        {listLike && <Checklist legend="Columns" options={fields} value={cfg.columns ?? []} onChange={(columns) => set({ columns })} />}
        {listLike && <Checklist legend="Filters" options={fields} value={cfg.filters ?? []} onChange={(filters) => set({ filters })} />}
        {listLike && (
          <Field label="Group by">
            <Select value={cfg.group_by ?? ''} onChange={(e) => set({ group_by: e.target.value || undefined })} disabled={!canEdit}>
              <option value="">No grouping</option>
              {table.fields.filter((f) => ['select', 'reference', 'boolean', 'text'].includes(f.type)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </Select>
          </Field>
        )}
        {!listLike && <Checklist legend="Fields shown" options={fields} value={cfg.fields ?? []} onChange={(f) => set({ fields: f })} />}
        <Checklist legend="Actions" options={ACTIONS.map(([key, label]) => ({ key, label }))} value={cfg.actions ?? ['create']} onChange={(picked) => set({ actions: [...(cfg.actions ?? ['create']).filter((a) => a !== 'create'), ...picked] })} />
        <p className="-mt-2 text-xs text-muted">Export and Import for this table are set in its Features tab.</p>
        <Field label="Empty-state text" hint="Shown when there is nothing to list yet">
          <Input value={cfg.empty_text ?? ''} maxLength={200} onChange={(e) => set({ empty_text: e.target.value })} disabled={!canEdit} />
        </Field>
        {canEdit && (
          <Button variant="primary" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
            Save screen
          </Button>
        )}
      </Card>
      <section aria-label="Live preview" className="min-w-0 overflow-x-auto rounded-lg border border-dashed border-line bg-canvas p-4" data-testid="screen-preview">
        <p className="mb-3 text-xs font-semibold tracking-wide text-muted uppercase">Live preview with your data</p>
        {screen.pattern === 'master_detail' ? (
          <MasterDetail tableKey={screen.table} title={title} config={cfg} tableOverride={table} preview />
        ) : (
          <RecordsList tableKey={screen.table} title={title} config={cfg} tableOverride={table} preview />
        )}
      </section>
    </div>
  )
}

export function ScreensTab({ canEdit, tableKey }: { canEdit: boolean; tableKey: string }) {
  const screens = useQuery({ queryKey: ['studio-screens'], queryFn: studio.screens, retry: false })
  const tables = useDraftTables()
  const [selected, setSelected] = useState<string | null>(null)
  const [gallery, setGallery] = useState(false)
  const stages = useStages()
  if (screens.isLoading || tables.isLoading) return <LoadingState label="Loading screens" />
  if (screens.isError) return <ErrorState requestId={(screens.error as ApiError).requestId} onRetry={() => void screens.refetch()} />
  const all = (screens.data ?? []).filter((s) => s.table === tableKey)
  const current = all.find((s) => s.key === selected) ?? all[0]
  const table = tables.data?.find((t) => t.key === current?.table)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {all.length > 0 ? (
          <Select aria-label="Screen to configure" className="w-64" value={current?.key ?? ''} onChange={(e) => setSelected(e.target.value)}>
            {all.map((s) => <option key={s.key} value={s.key}>{s.title}</option>)}
          </Select>
        ) : (
          <p className="text-sm text-muted">No screens show this table yet.</p>
        )}
        {current && stages.of('screens', current.key) && <StageBadge stage={stages.of('screens', current.key)!} isNew={stages.isNew('screens', current.key)} />}
        {canEdit && (
          <Button onClick={() => setGallery((g) => !g)} aria-expanded={gallery}>
            <Plus className="size-4" aria-hidden /> New screen from a pattern
          </Button>
        )}
      </div>
      {gallery && tables.data && (
        <Gallery
          tables={tables.data.filter((t) => t.key === tableKey)}
          onCreated={(k) => {
            setGallery(false)
            setSelected(k)
          }}
        />
      )}
      {current && table && <Configurator key={`${current.key}-${current.version}`} screen={current} table={table} canEdit={canEdit} />}
    </div>
  )
}
