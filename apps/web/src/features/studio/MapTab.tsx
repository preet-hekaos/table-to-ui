import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Plus } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { ApiError } from '@/api/client'
import { studio, type Link } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Button, ErrorState, LoadingState } from '@/design-system'
import { useDraftTables } from './DataTab'
import { NewTableDialog } from './FieldDialog'
import { AddLink, AddMany, EditLink } from './RelationshipsTab'

const W = 220
const GX = 80
const GY = 60

type Box = { table: StudioTable; links: number; open: (table: string) => void }

/** One table as a box: its name, its first fields (links marked), and a dot to drag a link from or to. */
function TableBox({ data, selected }: NodeProps<Node<Box>>) {
  const t = data.table
  const shown = t.fields.filter((f) => !f.hidden).slice(0, 6)
  const more = t.fields.filter((f) => !f.hidden).length - shown.length
  return (
    <div
      className={`rounded-lg border bg-surface text-left shadow-sm ${selected ? 'border-accent ring-2 ring-accent' : 'border-line'}`}
      style={{ width: W }}
      data-testid={`box-${t.key}`}
    >
      <Handle type="target" position={Position.Left} className="!size-3 !border-2 !border-accent !bg-surface" />
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="truncate text-sm font-bold text-ink">{t.label}</span>
        <span className="shrink-0 text-[10px] font-semibold text-muted uppercase">{t.source === 'pack' ? 'Pack' : 'Yours'}</span>
      </div>
      <button type="button" className="nodrag mx-3 mt-2 text-left text-xs font-semibold text-accent-ink hover:underline" onClick={() => data.open(t.key)}>
        Open {t.label} fields
      </button>
      <ul className="flex flex-col gap-0.5 px-3 py-2 text-xs text-body">
        {shown.map((f) => (
          <li key={f.key} className="flex items-center justify-between gap-2">
            <span className="truncate">{f.label}</span>
            {f.type === 'reference' && <span className="shrink-0 text-accent-ink">→ link</span>}
          </li>
        ))}
        {more > 0 && <li className="text-muted">+ {more} more</li>}
      </ul>
      <Handle type="source" position={Position.Right} className="!size-3 !border-2 !border-accent !bg-accent" />
    </div>
  )
}

const nodeTypes = { table: TableBox }

/** Default place for a box: most-linked first, row by row. Deterministic, so a fresh canvas does not jump around. */
function defaultPositions(all: StudioTable[], edges: { from: string; to: string }[]): Record<string, { x: number; y: number }> {
  const degree = (k: string) => edges.filter((e) => e.from === k || e.to === k).length
  const ordered = [...all].sort((a, b) => degree(b.key) - degree(a.key) || a.label.localeCompare(b.label))
  const cols = Math.max(1, Math.ceil(Math.sqrt(ordered.length * 1.3)))
  return Object.fromEntries(ordered.map((t, i) => [t.key, { x: (i % cols) * (W + GX), y: Math.floor(i / cols) * (230 + GY) }]))
}

/** Screen 2.5: a canvas of table boxes. Drag a box to place it; drag from one box's dot to another to link them. */
export function MapTab({ canEdit, onOpen, onOpenLink }: { canEdit: boolean; onOpen: (table: string) => void; onOpenLink?: (id: string) => void }) {
  const tables = useDraftTables()
  const links = useQuery({ queryKey: ['studio-relationships'], queryFn: studio.relationships, retry: false })
  const layout = useQuery({ queryKey: ['studio-layout'], queryFn: studio.layout, retry: false })
  const [reset, setReset] = useState(0)
  if (tables.isError) return <ErrorState requestId={(tables.error as ApiError).requestId} onRetry={() => void tables.refetch()} />
  if (!tables.data || !links.data || layout.isLoading) return <LoadingState label="Drawing the canvas" />
  // The canvas keeps its own positions while you drag; it starts again whenever the saved data changes.
  const signature = JSON.stringify([tables.data.map((t) => [t.key, t.fields.length]), links.data.map((l) => l.id), reset])
  return <Canvas key={signature} onOpen={onOpen} onTidy={async () => {
    await layout.refetch()
    setReset((r) => r + 1)
  }} all={tables.data} list={links.data} saved={layout.data?.positions} canEdit={canEdit} onOpenLink={onOpenLink} />
}

function Canvas({ all, list, saved, canEdit, onOpen, onOpenLink, onTidy }: { onOpen: (table: string) => void; all: StudioTable[]; list: Link[]; saved?: Record<string, { x: number; y: number }>; canEdit: boolean; onOpenLink?: (id: string) => void; onTidy: () => Promise<void> }) {
  const qc = useQueryClient()
  const [nodes, setNodes] = useState<Node<Box>[]>(() => {
    const base = defaultPositions(all, list.map((l) => ({ from: l.table, to: l.to })))
    return all.map((t) => ({
      id: t.key,
      type: 'table',
      position: saved?.[t.key] ?? base[t.key]!,
      data: { table: t, links: list.filter((l) => l.table === t.key || l.to === t.key).length, open: onOpen },
      draggable: canEdit,
    }))
  })
  const [linkDraft, setLinkDraft] = useState<{ table: string; to: string } | null>(null)
  const [adding, setAdding] = useState<'link' | 'many' | 'table' | null>(null)
  const [editing, setEditing] = useState<Link | null>(null)
  const edges: Edge[] = useMemo(
    () =>
      (list ?? []).map((l) => ({
        id: l.id,
        source: l.table,
        target: l.to,
        label: `${l.label}${l.source === 'pack' ? '' : ' •'}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 1.5, strokeDasharray: l.source === 'pack' ? '6 4' : undefined },
        labelBgPadding: [6, 3] as [number, number],
        labelStyle: { fontSize: 11 },
        ariaLabel: `${l.table_label} to ${l.to_label}: ${l.label}`,
      })),
    [list],
  )

  const save = useMutation({
    mutationFn: (positions: Record<string, { x: number; y: number }>) => studio.saveLayout(positions),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio-layout'] }),
  })
  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((n) => applyNodeChanges(c, n) as Node<Box>[]), [])
  const onDragStop = useCallback(() => {
    setNodes((n) => {
      save.mutate(Object.fromEntries(n.map((x) => [x.id, { x: x.position.x, y: x.position.y }])))
      return n
    })
  }, [save])
  const onConnect = (c: Connection) => {
    if (canEdit && c.source && c.target) setLinkDraft({ table: c.source, to: c.target })
  }

  const label = (k: string) => all.find((t) => t.key === k)?.label

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted">
          {all.length} tables and {list.length} links. {canEdit ? 'Drag a box to place it. Drag from the dot on one box to another to link them. Choose a line to edit it.' : 'Choose a line to see the link.'}
        </p>
        {canEdit && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setAdding('table')}>
              <Plus className="size-4" aria-hidden /> New table
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding('link')}>Add a link</Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => save.mutate({}, { onSuccess: onTidy })}
            >
              Tidy up
            </Button>
          </>
        )}
      </div>
      <div className="h-[560px] overflow-hidden rounded-lg border border-line bg-canvas" role="region" aria-label="Table canvas" data-testid="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={onDragStop}
          onConnect={onConnect}
          onEdgeClick={(_, e) => {
            const l = list.find((x) => x.id === e.id)
            if (l && canEdit) setEditing(l)
            else if (l) onOpenLink?.(l.id)
          }}
          nodesConnectable={canEdit}
          nodesDraggable={canEdit}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="Overview of the canvas" />
        </ReactFlow>
      </div>
      <p className="text-xs text-muted">Solid lines with a dot are links you added. Dashed lines come with the pack.</p>
      <details className="rounded-lg border border-line bg-surface p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-accent-ink">Links as a list</summary>
        <ul className="mt-2 flex flex-col gap-1 text-body">
          {list.map((l) => (
            <li key={l.id}>
              <button type="button" className="text-left hover:underline" onClick={() => {
                  if (canEdit) setEditing(l)
                  else onOpenLink?.(l.id)
                }}>
                {label(l.table)} → {label(l.to)} <span className="text-muted">({l.label})</span>
              </button>
            </li>
          ))}
        </ul>
      </details>
      {linkDraft && <AddLink initial={linkDraft} onClose={() => setLinkDraft(null)} />}
      {adding === 'link' && <AddLink onClose={() => setAdding(null)} />}
      {adding === 'many' && <AddMany onClose={() => setAdding(null)} />}
      {adding === 'table' && (
        <NewTableDialog
          open
          onOpenChange={(o) => !o && setAdding(null)}
          onCreated={() => {
            setAdding(null)
            void Promise.all(['studio-tables', 'studio-relationships', 'studio-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
          }}
        />
      )}
      {editing && <EditLink link={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
