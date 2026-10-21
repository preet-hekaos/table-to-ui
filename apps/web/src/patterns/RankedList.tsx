import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useState } from 'react'
import { useDebounced } from '@/lib/useDebounced'
import { ApiError } from '@/api/client'
import { app, matching } from '@/api/endpoints'
import type { ScreenConfig } from '@/api/types'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, NotFound, useToast } from '@/design-system'
import { ExplainMatch } from '@/features/ai/Ai'
import { can, useMe } from '@/features/auth/useMe'
import { formatField } from './format'


/** Pattern "ranked list" (S25): records in score order for a source record, every part of the score shown.
 *  Weights changed here apply to this view only; the workspace default needs the matching-settings permission. */
export function RankedList({ screenKey, sourceId }: { screenKey: string; sourceId: string }) {
  const me = useMe()
  const qc = useQueryClient()
  const toast = useToast()
  const screen = useQuery({ queryKey: ['screen', screenKey], queryFn: () => app.screen(screenKey), retry: false })
  const [weights, setWeights] = useState<Record<string, number> | null>(null)
  const sent = useDebounced(weights, 200)
  const res = useQuery({
    queryKey: ['matches', screenKey, sourceId, sent],
    queryFn: () => matching.get(screenKey, sourceId, sent ?? undefined),
    placeholderData: (p) => p,
    retry: false,
  })
  const target = useQuery({ queryKey: ['table', screen.data?.screen.table], queryFn: () => app.table(screen.data!.screen.table), enabled: !!screen.data })
  const save = useMutation({
    mutationFn: () => matching.saveWeights(screenKey, weights ?? res.data!.weights),
    onSuccess: async () => {
      toast({ title: 'Saved as the workspace default', tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['matches', screenKey] })
    },
    onError: (e) => toast({ title: 'Could not save', description: (e as Error).message, tone: 'bad' }),
  })
  const err = screen.error ?? res.error
  if (err instanceof ApiError && err.status === 404) return <NotFound />
  if (err) return <ErrorState requestId={(err as ApiError).requestId} onRetry={() => void res.refetch()} />
  if (!res.data || !screen.data || !target.data) return <LoadingState label="Ranking" />
  const r = res.data
  const cfg = screen.data.screen.config as ScreenConfig & { parts?: { key: string; label: string }[] }
  const table = target.data.table
  const w = weights ?? r.weights
  const cols = (cfg.columns ?? []).map((k) => table.fields.find((f) => f.key === k)).filter((f) => f && f.key !== table.title_field)
  const changed = JSON.stringify(w) !== JSON.stringify(r.defaults)
  return (
    <div className="flex flex-col gap-4">
      <Link to="/records/$table/$id" params={{ table: r.source.table, id: r.source.id }} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {String(r.source.label ?? 'Back')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-ink">{screen.data.screen.title} for {String(r.source.label ?? '')}</h1>
        <Badge>{r.considered} passed the hard filters</Badge>
      </div>
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-ink">Weights</h2>
          <span className="text-xs text-muted">Change them to re-rank this view. No AI: the same inputs always give the same order.</span>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-5">
          {(cfg.parts ?? []).map((p) => (
            <label key={p.key} className="flex flex-col gap-1 text-xs font-semibold text-ink">
              {p.label} <span className="text-muted">{w[p.key] ?? 0}</span>
              <input type="range" min={0} max={100} step={5} value={w[p.key] ?? 0} aria-label={`Weight for ${p.label}`} onChange={(e) => setWeights({ ...w, [p.key]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          {weights && <Button size="sm" variant="ghost" onClick={() => setWeights(null)}>Reset</Button>}
          {can(me.data?.permissions, 'matching.configure') && changed && (
            <Button size="sm" onClick={() => save.mutate()} loading={save.isPending}>Save as workspace default</Button>
          )}
        </div>
      </Card>
      {r.items.length === 0 ? (
        <EmptyState title="No matches yet">Nobody passes the hard filters for this one.</EmptyState>
      ) : (
        <ol className="flex flex-col gap-2" aria-label="Ranked matches">
          {r.items.map((it, i) => (
            <li key={it.id} className="rounded-lg border border-line bg-surface p-3" data-testid="match">
              <div className="flex flex-wrap items-center gap-3">
                <span className="w-6 text-right text-sm font-bold text-muted">{i + 1}</span>
                <Link to="/records/$table/$id" params={{ table: table.key, id: it.id }} className="font-semibold text-accent-ink hover:underline">
                  {String(it.data[table.title_field] ?? '')}
                </Link>
                <span className="text-xs text-muted">
                  {cols.slice(0, 3).map((f, j) => f && it.data[f.key] != null && (
                    <span key={f.key}>{j > 0 && ' · '}{formatField(f, it.data[f.key])}</span>
                  ))}
                </span>
                <span className="ml-auto text-lg font-bold text-ink" aria-label={`Score ${Math.round(it.score)} out of 100`}>{Math.round(it.score)}</span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-5">
                {Object.entries(it.parts).map(([k, p]) => (
                  <div key={k} className="text-xs" title={p.why}>
                    <div className="flex justify-between text-muted">
                      <span>{p.label}</span>
                      <span>{Math.round(p.points)}/{p.weight}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-soft" aria-hidden>
                      <div className="h-1.5 rounded bg-accent" style={{ width: `${p.fraction * 100}%` }} />
                    </div>
                    <p className="mt-0.5 truncate text-body">{p.why}</p>
                  </div>
                ))}
              </div>
              <ExplainMatch screen={screenKey} sourceId={sourceId} targetId={it.id} table={table.key} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {cols.slice(3).map((f) => f && <span key={f.key}>{f.label}: {formatField(f, it.data[f.key])}</span>)}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
