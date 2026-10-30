import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ApiError } from '@/api/client'
import { app, flow, type OverrideInput } from '@/api/endpoints'
import type { BoardColumn, FieldDef, RecordRow, RuleOutcome, TableDef } from '@/api/types'
import { can, useMe } from '@/features/auth/useMe'
import { RequestApproval } from '@/features/approvals/RequestApproval'
import { Badge, Button, Dialog, DialogContent, EmptyState, ErrorState, Field, Input, LoadingState, Select, useToast } from '@/design-system'
import { AskFields } from './AskFields'

type Move = { card: RecordRow; to: string; extra?: Record<string, unknown> }
type Blocked = Move & { violations: RuleOutcome[] }
type NeedsApproval = Move & { checks: RuleOutcome[] }

/** Pattern: stages as columns, one card per record. Drag a card, or use its "Move to" menu. */
export function Board({ tableKey, title, filter }: { tableKey: string; title: string; filter?: { ref: string; id: string } }) {
  const qc = useQueryClient()
  const toast = useToast()
  const me = useMe()
  const [chosen, setChosen] = useState<string>(filter?.id ?? '')
  const refField = filter?.ref
  const [q, setQ] = useState('')
  const table = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const refs = useMemo(() => (table.data?.table.fields ?? []).filter((f) => f.type === 'reference' && f.filterable), [table.data])
  const [refKey, setRefKey] = useState<string>(refField ?? '')
  const activeRef = refKey || refs.find((f) => f.key === 'requirement')?.key || refs[0]?.key || ''
  const filters: Record<string, string> = chosen && activeRef ? { [activeRef]: chosen } : {}
  const board = useQuery({ queryKey: ['board', tableKey, filters, q], queryFn: () => flow.board(tableKey, filters, q), retry: false })
  const options = useQuery({
    queryKey: ['board-options', tableKey, activeRef],
    queryFn: () => app.facets(tableKey, { fields: [activeRef] }),
    enabled: !!activeRef,
  })

  const [ask, setAsk] = useState<Move | null>(null)
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  const [approval, setApproval] = useState<NeedsApproval | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)

  if (table.isLoading || board.isLoading) return <LoadingState label="Loading the pipeline" />
  if (board.error instanceof ApiError && board.error.status === 403) return <div role="alert">Your role cannot see this board.</div>
  if (board.isError || !board.data || !table.data) return <ErrorState requestId={(board.error as ApiError | null)?.requestId} onRetry={() => void board.refetch()} />
  const def: TableDef = table.data.table
  const data = board.data
  const refresh = () => qc.invalidateQueries({ queryKey: ['board', tableKey] })
  const refLabel = (c: RecordRow) => Object.entries(c.refs ?? {}).filter(([k]) => k !== activeRef || !chosen).map(([, v]) => v.label).filter(Boolean)

  async function move(m: Move, override?: OverrideInput) {
    try {
      const body = { [data.field]: m.to, ...(m.extra ?? {}) }
      const rec = await flow.move(tableKey, m.card.id, m.card.version, body, override)
      const warn = (rec as RecordRow & { warnings?: RuleOutcome[] }).warnings ?? []
      toast({ title: `Moved to ${m.to}${warn.length ? `. ${warn[0]!.message}` : ''}`, tone: 'ok' })
      setBlocked(null)
      await refresh()
    } catch (e) {
      if (!(e instanceof ApiError)) return toast({ title: 'Something went wrong. Nothing was moved.', tone: 'bad' })
      if (e.is('rule-blocked')) {
        setBlocked({ ...m, violations: (e.body.violations as RuleOutcome[] | undefined) ?? [e.body.rule as RuleOutcome] })
      } else if (e.is('approval-required')) {
        setApproval({ ...m, checks: (e.body.approval as { checks: RuleOutcome[] }).checks })
      } else if (e.is('version-conflict')) {
        toast({ title: 'Someone else changed this card. The board is reloaded.', tone: 'neutral' })
        await refresh()
      } else {
        toast({ title: e.message, tone: 'bad' })
      }
    }
  }

  function attempt(card: RecordRow, to: string) {
    const col = data.columns.find((c) => c.stage === to)
    if (!col || String(card.data[data.field]) === to) return
    if (col.ask.length) setAsk({ card, to })
    else void move({ card, to })
  }

  const canOverride = can(me.data?.permissions, 'rule.override')
  const canMove = can(me.data?.permissions, `record.${tableKey}.update`)
  return (
    <div className="flex min-w-0 max-w-full flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-xl font-bold text-ink">{title}</h1>
        {refs.length > 0 && (
          <Field label={`Show ${(refs.find((f) => f.key === activeRef)?.label ?? 'all').toLowerCase()}`}>
            <Select value={chosen} onChange={(e) => setChosen(e.target.value)}>
              <option value="">All</option>
              {options.data?.facets[activeRef]?.values.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label} ({v.count})
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Search the board">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or role" />
        </Field>
        {refs.length > 1 && (
          <Field label="Group by">
            <Select
              value={activeRef}
              onChange={(e) => {
                setRefKey(e.target.value)
                setChosen('')
              }}
            >
              {refs.map((f: FieldDef) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {data.total === 0 ? (
        <EmptyState title="Nothing in the pipeline yet" action={<Button asChild variant="primary"><Link to="/records/$table/new" params={{ table: tableKey }}>Add to pipeline</Link></Button>}>
          Add a candidate to a requirement and they appear here, one column per stage.
        </EmptyState>
      ) : (
        <div className="relative flex w-full max-w-full gap-3 overflow-x-auto pb-3" role="list" aria-label="Stages">
          {data.columns.map((col) => (
            <Column
              key={col.stage}
              col={col}
              title={def.title_field}
              field={data.field}
              refLabel={refLabel}
              labels={Object.fromEntries(data.columns.map((c) => [c.stage, c.label]))}
              canMove={canMove}
              dragging={dragging}
              setDragging={setDragging}
              onDropCard={(id) => {
                const card = data.columns.flatMap((c) => c.cards).find((c) => c.id === id)
                if (card) attempt(card, col.stage)
              }}
              onMove={attempt}
            />
          ))}
        </div>
      )}

      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        {ask && (
          <DialogContent title={`Move to ${ask.to}`} description="Add details for this stage. You can leave them empty unless a rule asks for them.">
            <AskFields
              fields={(data.columns.find((c) => c.stage === ask.to)?.ask ?? []).map((k) => def.fields.find((f) => f.key === k)!).filter(Boolean)}
              onCancel={() => setAsk(null)}
              onSubmit={(extra) => {
                const m = { ...ask, extra }
                setAsk(null)
                void move(m)
              }}
              submitLabel={`Move to ${ask.to}`}
            />
          </DialogContent>
        )}
      </Dialog>

      <Dialog open={!!blocked} onOpenChange={(o) => !o && setBlocked(null)}>
        {blocked && <BlockedDialog blocked={blocked} canOverride={canOverride} onOverride={(reason) => void move(blocked, { checks: blocked.violations.filter((v) => v.overridable).map((v) => v.check), reason })} />}
      </Dialog>

      {approval && (
        <RequestApproval
          open
          onOpenChange={(o) => !o && setApproval(null)}
          request={{
            table: tableKey,
            action: 'update',
            record_id: approval.card.id,
            version: approval.card.version,
            data: { [data.field]: approval.to, ...(approval.extra ?? {}) },
          }}
          checks={approval.checks}
          onSent={() => setApproval(null)}
        />
      )}
    </div>
  )
}

function BlockedDialog({ blocked, canOverride, onOverride }: { blocked: Blocked; canOverride: boolean; onOverride: (reason: string) => void }) {
  const [reason, setReason] = useState('')
  const overridable = blocked.violations.every((v) => v.overridable)
  return (
    <DialogContent title={`Cannot move to ${blocked.to}`} description="A rule stopped this move.">
      <ul className="flex flex-col gap-2 text-sm">
        {blocked.violations.map((v) => (
          <li key={v.check} role="alert" className="rounded-md bg-bad-soft p-2 text-bad-ink">
            <span className="font-semibold">Rule {v.rule}</span>: {v.message}
          </li>
        ))}
      </ul>
      {overridable && canOverride && (
        <div className="mt-4 flex flex-col gap-2">
          <Field label="Override with a reason" hint="The reason is kept in the audit trail." required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button variant="danger" disabled={!reason.trim()} onClick={() => onOverride(reason)}>
            Move anyway
          </Button>
        </div>
      )}
      {overridable && !canOverride && <p className="mt-3 text-xs text-muted">A manager can override this rule with a reason.</p>}
    </DialogContent>
  )
}

function Column({
  col,
  title,
  field,
  refLabel,
  labels,
  canMove,
  dragging,
  setDragging,
  onDropCard,
  onMove,
}: {
  col: BoardColumn
  title: string
  field: string
  refLabel: (c: RecordRow) => (string | null)[]
  labels: Record<string, string>
  canMove: boolean
  dragging: string | null
  setDragging: (id: string | null) => void
  onDropCard: (id: string) => void
  onMove: (card: RecordRow, to: string) => void
}) {
  const [over, setOver] = useState(false)
  return (
    <section
      role="listitem"
      aria-label={`${col.label}, ${col.count} ${col.count === 1 ? 'card' : 'cards'}`}
      onDragOver={(e) => {
        if (dragging && canMove) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        const id = e.dataTransfer.getData('text/plain') || dragging
        setDragging(null)
        if (id && canMove) onDropCard(id)
      }}
      className={`flex w-64 shrink-0 flex-col gap-2 rounded-lg border bg-canvas p-2 ${over ? 'border-accent bg-accent-soft' : 'border-line'}`}
    >
      <h2 className="flex items-center justify-between px-1 text-sm font-semibold text-ink">
        {col.label}
        <Badge tone={col.end || col.count === 0 ? 'neutral' : 'accent'}>{col.count}</Badge>
      </h2>
      {col.cards.length === 0 && <p className="px-1 py-3 text-xs text-muted">No one at this stage.</p>}
      {col.cards.map((c) => (
        <article
          key={c.id}
          draggable={canMove}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', c.id)
            setDragging(c.id)
          }}
          onDragEnd={() => setDragging(null)}
          className={`flex flex-col gap-1.5 rounded-md border border-line bg-surface p-2.5 shadow-sm ${canMove ? 'cursor-grab' : ''}`}
        >
          <Link to="/records/$table/$id" params={{ table: c.table, id: c.id }} className="text-sm font-semibold text-ink hover:underline">
            {String(c.data[title] ?? 'Untitled')}
          </Link>
          {refLabel(c).map((l) => (
            <p key={l} className="text-xs text-muted">{l}</p>
          ))}
          {canMove && col.next.length > 0 && (
            <>
              <label className="sr-only" htmlFor={`mv-${c.id}`}>{`Move ${String(c.data[title])} to`}</label>
              <select
                id={`mv-${c.id}`}
                value=""
                onChange={(e) => e.target.value && onMove(c, e.target.value)}
                className="h-7 rounded-md border border-line bg-surface px-1 text-xs text-body"
              >
                <option value="">Move to…</option>
                {col.next.map((s) => (
                  <option key={s} value={s}>{labels[s] ?? s}</option>
                ))}
              </select>
            </>
          )}
          <span className="sr-only">{field}</span>
        </article>
      ))}
      {col.count > col.cards.length && <p className="px-1 text-xs text-muted">Showing {col.cards.length} of {col.count}. Narrow the board to see the rest.</p>}
    </section>
  )
}
