import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { cn } from '@/design-system'
import type { CardData } from './TableCard'
import { useStages } from '../useStages'

const ring = { draft: 'border-stage-draft', test: 'border-stage-test', live: 'border-stage-live', removed: 'border-stage-removed' } as const

/** Graph view: one table as a dot. The more links it has, the bigger it is. */
export function TableDot({ data, selected }: NodeProps<Node<CardData>>) {
  const t = data.table
  const stage = useStages().of('tables', t.key)
  const size = 18 + Math.min(data.links, 10) * 4
  const hidden = { opacity: 0, left: '50%', top: '50%', pointerEvents: 'none' as const }
  return (
    <div className="flex flex-col items-center gap-1" data-testid={`box-${t.key}`} data-stage={stage} style={{ width: 112 }}>
      <button
        type="button"
        onClick={() => data.onSelect(t.key)}
        className={cn(
          'relative rounded-full border-4 bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          stage ? ring[stage] : 'border-accent',
          selected && 'ring-2 ring-accent ring-offset-2',
          data.related && 'bg-accent',
        )}
        style={{ width: size, height: size }}
      >
        <span className="sr-only">Open details of {t.label}, {data.links} {data.links === 1 ? 'link' : 'links'}</span>
        <Handle type="source" position={Position.Top} style={hidden} />
        <Handle type="target" position={Position.Top} style={hidden} />
      </button>
      <span className="max-w-full truncate rounded bg-canvas px-1 text-xs font-semibold text-ink">{t.label}</span>
    </div>
  )
}
