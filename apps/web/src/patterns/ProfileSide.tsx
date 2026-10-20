import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { app } from '@/api/endpoints'
import type { HistoryEntry, RecordRow, TableDef } from '@/api/types'
import { Badge, Card, CardTitle } from '@/design-system'
import { useFileUrl } from '@/features/workspace/useBrand'
import { formatField } from './format'

export interface ProfileConfig {
  key_fields?: string[]
  preview?: { table: string; via: string; file_field: string; where?: Record<string, string> }
  badges?: { label: string; table: string; via: string; field: string }[]
  timeline?: { table: string; via: string; date_field?: string }[]
}

export interface TimelineItem {
  key: string
  at: string
  who: string | null
  what: string
  version?: string
  link?: { table: string; id: string }
}

/** The profile screen of a table, if the app has one (it adds key facts, a document preview, badges and a timeline). */
export function useProfile(tableKey: string): ProfileConfig | null {
  const q = useQuery({ queryKey: ['screens', 'profile', tableKey], queryFn: () => app.screens({ table: tableKey, pattern: 'profile' }), staleTime: 60_000 })
  return (q.data?.[0]?.config as ProfileConfig | undefined) ?? null
}

function describe(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string {
  if (!before) return 'Created'
  if (!after) return 'Removed'
  const changed = Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
  return changed.length ? `Changed ${changed.join(', ')}` : 'Saved with no changes'
}

/** History and the records the profile lists as events (for example calls and meetings), newest first. */
export function useTimeline(id: string, config: ProfileConfig | null, history: HistoryEntry[] | undefined): TimelineItem[] {
  const specs = config?.timeline ?? []
  const lists = useQueries({
    queries: specs.map((t) => ({ queryKey: ['related', t.table, t.via, id], queryFn: () => app.related(t.table, t.via, id) })),
  })
  const defs = useQueries({ queries: specs.map((t) => ({ queryKey: ['table', t.table], queryFn: () => app.table(t.table), staleTime: 60_000 })) })
  if (!config) return []
  const items: TimelineItem[] = (history ?? []).map((h) => ({
    key: `h-${h.seq}`,
    at: h.at,
    who: h.actor_name,
    what: describe(h.before, h.after),
    version: h.app_version,
  }))
  specs.forEach((t, i) => {
    const def = defs[i]?.data?.table
    for (const r of lists[i]?.data?.items ?? []) {
      const title = def ? String(r.data[def.title_field] ?? def.label) : t.table
      const kind = r.data.kind ? `${String(r.data.kind)}: ` : ''
      const when = (t.date_field && (r.data[t.date_field] as string | undefined)) || r.created_at
      items.push({ key: `${t.table}-${r.id}`, at: when, who: r.owner?.name ?? null, what: `${kind}${title}`, link: { table: t.table, id: r.id } })
    }
  })
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.key.localeCompare(b.key)))
}

function Badges({ config, id }: { config: ProfileConfig; id: string }) {
  const badges = config.badges ?? []
  const lists = useQueries({ queries: badges.map((b) => ({ queryKey: ['related', b.table, b.via, id], queryFn: () => app.related(b.table, b.via, id) })) })
  if (!badges.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {badges.map((b, i) => {
        const latest = [...(lists[i]?.data?.items ?? [])].sort((x, y) => (x.updated_at < y.updated_at ? 1 : -1))[0]
        const v = latest ? String(latest.data[b.field] ?? '') : 'Not recorded'
        return (
          <Badge key={b.label} tone={v === 'Given' || v === 'Active' ? 'ok' : latest ? 'warn' : 'neutral'}>
            {b.label}: {v}
          </Badge>
        )
      })}
    </div>
  )
}

function Preview({ config, id }: { config: ProfileConfig; id: string }) {
  const p = config.preview!
  const docs = useQuery({ queryKey: ['related', p.table, p.via, id], queryFn: () => app.related(p.table, p.via, id) })
  const match = (r: RecordRow) => Object.entries(p.where ?? {}).every(([k, v]) => r.data[k] === v)
  const latest = [...(docs.data?.items ?? [])].filter(match).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
  const fileId = latest ? String(latest.data[p.file_field] ?? '') : null
  const url = useFileUrl(fileId || null)
  return (
    <Card data-testid="document-preview">
      <CardTitle>{p.where?.kind ?? 'Document'}</CardTitle>
      {!latest ? (
        <p className="text-sm text-muted">No {String(p.where?.kind ?? 'document').toLowerCase()} yet.</p>
      ) : url ? (
        <iframe src={url} title={`Preview of the latest ${String(p.where?.kind ?? 'document')}`} className="mt-2 h-72 w-full rounded-md border border-line" />
      ) : (
        <p className="text-sm text-muted">Loading the document…</p>
      )}
    </Card>
  )
}

/** The profile's key facts, badges, latest document and recent timeline. On a phone this comes first. */
export function ProfileSide({ config, table, record, timeline }: { config: ProfileConfig; table: TableDef; record: RecordRow; timeline: TimelineItem[] }) {
  const facts = (config.key_fields ?? []).map((k) => table.fields.find((f) => f.key === k)).filter((f) => f && !f.hidden && k_in(record, f.key))
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]" data-testid="profile-summary">
      <div className="flex flex-col gap-3">
        <Badges config={config} id={record.id} />
        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-line bg-surface p-3 text-sm sm:grid-cols-3" aria-label="Key details">
            {facts.map((f) => (
              <div key={f!.key}>
                <dt className="text-xs text-muted">{f!.label}</dt>
                <dd className="font-medium text-ink">{formatField(f, record.data[f!.key], record.refs?.[f!.key])}</dd>
              </div>
            ))}
          </dl>
        )}
        {timeline.length > 0 && (
          <Card aria-label="Recent activity">
            <CardTitle>Recent activity</CardTitle>
            <ol className="mt-2 flex flex-col gap-2 text-sm">
              {timeline.slice(0, 5).map((t) => (
                <li key={t.key} className="flex gap-2">
                  <span className="w-24 shrink-0 text-xs text-muted">{new Date(t.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  <span className="text-body">
                    {t.link ? <Link to="/records/$table/$id" params={t.link} className="text-accent-ink hover:underline">{t.what}</Link> : t.what}
                    {t.who && <span className="text-muted"> · {t.who}</span>}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
      {config.preview && <Preview config={config} id={record.id} />}
    </div>
  )
}

function k_in(record: RecordRow, key: string) {
  const v = record.data[key]
  return v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
}
