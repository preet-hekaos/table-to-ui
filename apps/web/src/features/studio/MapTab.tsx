import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { FileDown, FileUp, Plus, Search } from 'lucide-react'
import { useCallback, useMemo, useState, type FormEvent } from 'react'
import type { ApiError } from '@/api/client'
import { studio, type Link } from '@/api/endpoints'
import type { StudioTable } from '@/api/types'
import { Badge, Button, ErrorState, Input, LoadingState } from '@/design-system'
import { forceLayout } from './canvas/force'
import { TableCard, type CardData } from './canvas/TableCard'
import { TableDot } from './canvas/TableDot'
import { RouteEdge } from './canvas/RouteEdge'
import { routeLinks } from './canvas/route'
import { TableDrawer } from './canvas/TableDrawer'
import { layeredLayout } from './canvas/layout'
import { useDraftTables } from './useDraftTables'
import { NewTableDialog } from './FieldDialog'
import { SchemaExportDialog } from './SchemaExportDialog'
import { SchemaImportDialog } from './SchemaImportDialog'
import { AddLink, AddMany, EditLink, LinkHealth } from './RelationshipsTab'

const nodeTypes = { table: TableCard, dot: TableDot }
const edgeTypes = { route: RouteEdge }

/** One colour for every line that leaves a table, so a line can be followed by its colour. */
const LINE_COLOURS = ['#2563eb', '#db2777', '#0d9488', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d']

type View = 'cards' | 'graph'
const VIEW_KEY = 'tableui.canvas.view'
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'graph' ? 'graph' : 'cards'
  } catch {
    return 'cards'
  }
}

type Pos = Record<string, { x: number; y: number }>

/** Screen 2.5: the canvas. Small cards, parents on the left, lines that rarely cross; click a card for its details. */
export function MapTab({ canEdit, onOpen }: { canEdit: boolean; onOpen: (table: string, part?: 'fields' | 'screens') => void }) {
  const tables = useDraftTables()
  const links = useQuery({ queryKey: ['studio-relationships'], queryFn: studio.relationships, retry: false })
  const layout = useQuery({ queryKey: ['studio-layout'], queryFn: studio.layout, retry: false })
  const [reset, setReset] = useState(0)
  const [view, setViewState] = useState<View>(readView)
  const setView = (v: View) => {
    setViewState(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      /* a remembered choice is a convenience only */
    }
  }
  if (tables.isError) return <ErrorState requestId={(tables.error as ApiError).requestId} onRetry={() => void tables.refetch()} />
  if (!tables.data || !links.data || layout.isLoading) return <LoadingState label="Drawing the canvas" />
  // The canvas keeps its own positions while you drag; it starts again whenever the saved data changes.
  const signature = JSON.stringify([tables.data.map((t) => [t.key, t.fields.length]), links.data.map((l) => l.id), reset, view])
  return (
    <ReactFlowProvider>
      <Canvas
        key={signature}
        view={view}
        onView={setView}
        all={tables.data}
        list={links.data}
        saved={layout.data?.positions}
        canEdit={canEdit}
        onOpen={onOpen}
        onTidy={async () => {
          await layout.refetch()
          setReset((r) => r + 1)
        }}
      />
    </ReactFlowProvider>
  )
}

/** Lines between the same two tables become one line that says how many links it carries. */
function mergeLinks(list: Link[]): { id: string; from: string; to: string; links: Link[] }[] {
  const groups = new Map<string, Link[]>()
  for (const l of list) {
    if (l.table === l.to) continue
    const k = `${l.table}\u0000${l.to}`
    groups.set(k, [...(groups.get(k) ?? []), l])
  }
  return [...groups.entries()].map(([k, links]) => {
    const [from, to] = k.split('\u0000') as [string, string]
    return { id: links.length === 1 ? links[0]!.id : `group:${from}:${to}`, from, to, links }
  })
}

function Canvas({
  view,
  onView,
  all,
  list,
  saved,
  canEdit,
  onOpen,
  onTidy,
}: {
  view: View
  onView: (v: View) => void
  all: StudioTable[]
  list: Link[]
  saved?: Pos
  canEdit: boolean
  onOpen: (table: string, part?: 'fields' | 'screens') => void
  onTidy: () => Promise<void>
}) {
  const qc = useQueryClient()
  const flow = useReactFlow()
  const [selected, setSelected] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [focus, setFocus] = useState(false)
  const [find, setFind] = useState('')
  const [findMessage, setFindMessage] = useState('')
  const [linkDraft, setLinkDraft] = useState<{ table: string; to: string } | null>(null)
  const [adding, setAdding] = useState<'link' | 'many' | 'table' | 'schema' | 'export' | null>(null)
  const [editing, setEditing] = useState<Link | null>(null)

  const merged = useMemo(() => mergeLinks(list), [list])
  const graph = view === 'graph'
  const auto = useMemo(() => {
    const keys = all.map((t) => t.key)
    const edges = list.map((l) => ({ from: l.table, to: l.to }))
    return graph ? forceLayout(keys, edges) : layeredLayout(keys, edges)
  }, [all, list, graph])
  const degree = useCallback(
    (k: string) => ({
      links: new Set(list.filter((l) => l.table !== l.to && (l.table === k || l.to === k)).map((l) => `${l.table}${l.to}${l.id}`)).size,
      self: list.filter((l) => l.table === k && l.to === k).length,
    }),
    [list],
  )
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>(all.map((t) => [t.key, new Set([t.key])]))
    for (const l of list) {
      m.get(l.table)?.add(l.to)
      m.get(l.to)?.add(l.table)
    }
    return m
  }, [all, list])

  const active = hovered ?? selected
  const near = active ? neighbours.get(active) : undefined
  /** Choose a table; the picture only moves when the table was asked for by name or from a list. */
  const select = useCallback(
    (k: string, move = false) => {
      setSelected(k)
      if (move) flow.fitView({ nodes: [{ id: k }], duration: 300, maxZoom: 1, padding: 1.5 })
    },
    [flow],
  )
  const selectAndShow = useCallback((k: string) => select(k, true), [select])

  // The canvas state keeps what React Flow measured (size), so only position changes come from here.
  const [base, setBase] = useState<Node<CardData>[]>(() =>
    all.map((t) => ({
      id: t.key,
      type: graph ? 'dot' : 'table',
      position: (!graph && saved?.[t.key]) || auto[t.key]!,
      data: { table: t, links: 0, selfLinks: 0, related: false, onSelect: () => undefined },
    })),
  )
  const positions: Pos = Object.fromEntries(base.map((n) => [n.id, n.position]))
  const nodes: Node<CardData>[] = base
    .filter((n) => !focus || !selected || neighbours.get(selected)?.has(n.id))
    .map((n) => {
      const t = all.find((x) => x.key === n.id)!
      const d = degree(n.id)
      return {
        ...n,
        selected: n.id === selected,
        draggable: canEdit,
        data: { table: t, links: d.links, selfLinks: d.self, related: !!near && near.has(n.id) && n.id !== active, onSelect: select },
      }
    })
  const visible = new Set(nodes.map((n) => n.id))
  const colourOf = useMemo(() => new Map(all.map((t) => t.key).sort().map((k, i) => [k, LINE_COLOURS[i % LINE_COLOURS.length]!])), [all])
  // The routes follow the cards, including while one is being dragged; a few dozen lines are quick to place.
  const routes = graph ? null : routeLinks(merged.map((m) => ({ id: m.id, from: m.from, to: m.to })), positions)
  const edges: Edge[] = merged
    .filter((m) => visible.has(m.from) && visible.has(m.to))
    .map((m) => {
      const touches = !active || m.from === active || m.to === active
      const many = m.links.length > 1
      const first = m.links[0]!
      const route = routes?.get(m.id)
      const colour = graph ? undefined : colourOf.get(m.from)
      return {
        id: m.id,
        source: m.from,
        target: m.to,
        type: route ? 'route' : graph ? 'straight' : 'smoothstep',
        data: route ? { d: route.d, labelX: route.label.x, labelY: route.label.y } : undefined,
        // The lines that touch the hovered or chosen table flow from the table that links to the one it points at.
        className: active && touches ? 'map-flow' : undefined,
        // Names only appear on the lines you are looking at, so a busy map stays quiet.
        label: many ? `${m.links.length} links` : active && touches ? `${first.label}${first.source === 'pack' ? '' : ' •'}` : undefined,
        markerEnd: graph ? undefined : { type: MarkerType.ArrowClosed, color: colour },
        style: {
          strokeWidth: many ? 3 : active && touches ? 2.25 : 1.75,
          strokeDasharray: !many && first.source === 'pack' ? '6 4' : undefined,
          opacity: touches ? 1 : 0.12,
          stroke: colour ?? (active && touches ? 'var(--color-accent)' : undefined),
        },
        labelBgPadding: [6, 3] as [number, number],
        labelStyle: { fontSize: 11 },
        ariaLabel: many ? `${first.table_label} to ${first.to_label}: ${m.links.length} links` : `${first.table_label} to ${first.to_label}: ${first.label}`,
      }
    })

  const save = useMutation({
    mutationFn: (p: Pos) => studio.saveLayout(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['studio-layout'] }),
  })
  const onNodesChange = (changes: NodeChange[]) => setBase((n) => applyNodeChanges(changes, n) as Node<CardData>[])
  const onConnect = (c: Connection) => {
    if (canEdit && c.source && c.target) setLinkDraft({ table: c.source, to: c.target })
  }

  const onFind = (e: FormEvent) => {
    e.preventDefault()
    const q = find.trim().toLowerCase()
    if (!q) return
    const hit = all.find((t) => t.label.toLowerCase() === q) ?? all.find((t) => t.label.toLowerCase().includes(q))
    if (hit) {
      setFindMessage('')
      select(hit.key, true)
    } else setFindMessage(`No table called "${find}".`)
  }

  const current = all.find((t) => t.key === selected)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="w-full text-sm text-muted">
          {all.length} tables and {list.length} links. {canEdit ? 'Click a card for its details. Drag a card to place it, or from its dot to another card to link them.' : 'Click a card for its details.'}
        </p>
        <div role="radiogroup" aria-label="Canvas view" className="flex overflow-hidden rounded-md border border-line text-sm">
          {(['cards', 'graph'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              onClick={() => onView(v)}
              className={`px-3 py-1.5 font-semibold ${view === v ? 'bg-accent-soft text-accent-ink' : 'bg-surface text-body hover:bg-soft'}`}
            >
              {v === 'cards' ? 'Cards' : 'Graph'}
            </button>
          ))}
        </div>
        <form onSubmit={onFind} role="search" className="flex items-center gap-1">
          <Input aria-label="Find a table" placeholder="Find a table" className="w-40" value={find} onChange={(e) => setFind(e.target.value)} list="canvas-tables" />
          <datalist id="canvas-tables">{all.map((t) => <option key={t.key} value={t.label} />)}</datalist>
          <Button size="sm" variant="secondary" type="submit" aria-label="Go to table"><Search className="size-4" aria-hidden /></Button>
        </form>
        <Button size="sm" variant="secondary" onClick={() => setAdding('export')}>
          <FileDown className="size-4" aria-hidden /> Export schema
        </Button>
        {canEdit && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setAdding('table')}>
              <Plus className="size-4" aria-hidden /> New table
            </Button>
            <Button size="sm" variant="secondary" className="border-dashed" onClick={() => setAdding('schema')}>
              <FileUp className="size-4" aria-hidden /> Import schema
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding('link')}>Add a link</Button>
            <Button size="sm" variant="secondary" onClick={() => setAdding('many')}>Add a many-to-many link</Button>
          </>
        )}
        <Button
          size="sm"
          variant={canEdit ? 'secondary' : 'ghost'}
          onClick={() => {
            if (canEdit && !graph) save.mutate({}, { onSuccess: onTidy })
            else void onTidy()
          }}
        >
          Auto-arrange
        </Button>
      </div>
      {findMessage && <p role="status" className="text-sm text-bad">{findMessage}</p>}
      <div className="relative h-[620px] overflow-hidden rounded-lg border border-line bg-canvas" role="region" aria-label="Table canvas" data-testid="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={() => {
            if (canEdit && !graph) save.mutate(positions)
          }}
          onNodeMouseEnter={(_, n) => setHovered(n.id)}
          onNodeMouseLeave={() => setHovered(null)}
          onPaneClick={() => setSelected(null)}
          onConnect={onConnect}
          onEdgeClick={(_, e) => {
            const m = merged.find((x) => x.id === e.id)
            if (!m) return
            if (m.links.length === 1 && canEdit) setEditing(m.links[0]!)
            else setSelected(m.from)
          }}
          nodesConnectable={canEdit}
          nodesDraggable={canEdit}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          onInit={() => window.setTimeout(() => void flow.fitView({ padding: 0.15 }), 80)}
          minZoom={0.15}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="Overview of the canvas" />
        </ReactFlow>
        {current && (
          <TableDrawer
            table={current}
            all={all}
            links={list}
            canEdit={canEdit}
            focus={focus}
            onFocus={setFocus}
            onClose={() => {
              setSelected(null)
              setFocus(false)
            }}
            onEditLink={setEditing}
            onAddLink={(t) => setLinkDraft({ table: t, to: '' })}
            onOpenFields={(k) => onOpen(k, 'fields')}
            onOpenScreens={(k) => onOpen(k, 'screens')}
            onSelect={selectAndShow}
          />
        )}
      </div>
      <p className="text-xs text-muted">Arrows point to the table being linked to. A thick line carries several links. Dashed lines come with the pack. Hover a card to light up its links.</p>
      <LinkHealth />
      <details className="rounded-lg border border-line bg-surface p-3 text-sm" data-testid="all-links">
        <summary className="cursor-pointer font-semibold text-accent-ink">All links ({list.length})</summary>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 text-xs text-muted">Changes stay in Draft until you publish.</p>
        </div>
        <ul className="mt-2 divide-y divide-line" aria-label="Links">
          {list.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2" data-testid={`link-${l.id}`}>
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
                <Button size="sm" variant="secondary" onClick={() => setEditing(l)} aria-label={`Edit link ${l.label} on ${l.table_label}`}>
                  Edit
                </Button>
              )}
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
      {adding === 'schema' && <SchemaImportDialog open onOpenChange={(o) => !o && setAdding(null)} />}
      {adding === 'export' && <SchemaExportDialog open onOpenChange={(o) => !o && setAdding(null)} tables={all.map((t) => ({ key: t.key, label: t.label }))} />}
      {editing && <EditLink link={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
