import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Repeat2 } from 'lucide-react'
import { StageBadge, cn, stageStripe } from '@/design-system'
import type { StudioTable } from '@/api/types'
import { useStages } from '../useStages'

export type CardData = {
  table: StudioTable
  /** Links to or from other tables. */
  links: number
  /** A link from this table back to itself. */
  selfLinks: number
  /** Linked to the table being looked at: its border is drawn in the accent colour. */
  related: boolean
  onSelect: (table: string) => void
  [key: string]: unknown
}

/** One table as a small card: its name, how many fields and links it has, and its stage. Click for the details. */
export function TableCard({ data, selected }: NodeProps<Node<CardData>>) {
  const t = data.table
  const stages = useStages()
  const stage = stages.of('tables', t.key)
  const fields = t.fields.filter((f) => !f.hidden).length
  return (
    <div
      className={cn(
        'map-card rounded-lg border bg-surface text-left shadow-sm',
        stageStripe(stage),
        selected ? 'border-accent' : data.related ? 'border-accent' : 'border-line',
      )}
      style={{ width: 176, height: 64 }}
      data-testid={`box-${t.key}`}
      data-stage={stage}
      data-lit={selected || undefined}
    >
      <Handle type="source" position={Position.Left} className="!size-3 !border-2 !border-accent !bg-accent" />
      <button
        type="button"
        className="flex h-full w-full flex-col justify-center gap-0.5 rounded-lg px-3 text-left focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => data.onSelect(t.key)}
        aria-pressed={selected}
      >
        <span className="sr-only">Open details of </span>
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-bold text-ink">{t.label}</span>
          {stage && stage !== 'live' && <StageBadge stage={stage} className="shrink-0" />}
        </span>
        <span className="flex items-center gap-2 text-xs text-muted">
          <span>{fields} {fields === 1 ? 'field' : 'fields'}</span>
          <span aria-hidden>·</span>
          <span>{data.links} {data.links === 1 ? 'link' : 'links'}</span>
          {data.selfLinks > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Links to itself">
              <Repeat2 className="size-3" aria-hidden />
              {data.selfLinks}
            </span>
          )}
        </span>
      </button>
      <Handle type="target" position={Position.Right} className="!size-3 !border-2 !border-accent !bg-surface" />
    </div>
  )
}
