import type { ApiError } from '@/api/client'
import { ErrorState, LoadingState } from '@/design-system'
import { useDraftTables } from './DataTab'

const W = 168
const H = 48
const GX = 56
const GY = 64

interface Edge {
  from: string
  to: string
  label: string
}

/** Screen 2.5: every table as a box, every link field as a line. Clicking a table opens it in Data. */
export function MapTab({ onOpen }: { onOpen: (table: string) => void }) {
  const tables = useDraftTables()
  if (tables.isLoading) return <LoadingState label="Drawing the map" />
  if (tables.isError) return <ErrorState requestId={(tables.error as ApiError).requestId} onRetry={() => void tables.refetch()} />
  const all = tables.data ?? []
  const keys = new Set(all.map((t) => t.key))
  const edges: Edge[] = all.flatMap((t) =>
    t.fields.filter((f) => f.type === 'reference' && f.ref_table && keys.has(f.ref_table)).map((f) => ({ from: t.key, to: f.ref_table!, label: f.label })),
  )
  // Most-linked tables first, laid out row by row; deterministic so the map does not jump around.
  const degree = (k: string) => edges.filter((e) => e.from === k || e.to === k).length
  const ordered = [...all].sort((a, b) => degree(b.key) - degree(a.key) || a.label.localeCompare(b.label))
  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.6)))
  const pos = new Map(ordered.map((t, i) => [t.key, { x: (i % cols) * (W + GX), y: Math.floor(i / cols) * (H + GY) }]))
  const width = cols * (W + GX) - GX
  const height = Math.ceil(ordered.length / cols) * (H + GY) - GY
  const centre = (k: string) => {
    const p = pos.get(k)!
    return { x: p.x + W / 2, y: p.y + H / 2 }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {all.length} tables and {edges.length} links. Choose a table to open its fields.
      </p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface p-4">
        <div className="relative" style={{ width, height }} data-testid="relationship-map">
          <svg width={width} height={height} className="absolute inset-0" aria-hidden>
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" className="fill-muted" />
              </marker>
            </defs>
            {edges.map((e, i) => {
              const a = centre(e.from)
              const b = centre(e.to)
              const mx = (a.x + b.x) / 2
              const my = (a.y + b.y) / 2 - 18
              return (
                <path
                  key={i}
                  d={`M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`}
                  className="fill-none stroke-muted"
                  strokeWidth={1.5}
                  markerEnd="url(#arrow)"
                />
              )
            })}
          </svg>
          {ordered.map((t) => {
            const p = pos.get(t.key)!
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onOpen(t.key)}
                className="absolute flex flex-col items-start justify-center rounded-md border border-line bg-surface px-3 text-left shadow-sm hover:border-accent focus-visible:border-accent"
                style={{ left: p.x, top: p.y, width: W, height: H }}
              >
                <span className="text-sm font-semibold text-ink">{t.label}</span>
                <span className="text-xs text-muted">
                  {t.fields.length} fields{t.source === 'agency' ? ' · workspace' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-accent-ink">Links as a list</summary>
        <ul className="mt-2 flex flex-col gap-1 text-body">
          {edges.map((e, i) => (
            <li key={i}>
              {all.find((t) => t.key === e.from)?.label} → {all.find((t) => t.key === e.to)?.label} <span className="text-muted">({e.label})</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  )
}
