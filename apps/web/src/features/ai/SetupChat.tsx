import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ai, type SetupPlan, type SetupStep } from '@/api/endpoints'
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState, useToast } from '@/design-system'
import { AiError } from './Ai'

const q = (v: unknown) => `“${String(v ?? '')}”`

/** One step in plain words. The owner reads these before anything is applied. */
export function describeStep(s: Pick<SetupStep, 'op' | 'args'>): string {
  const a = s.args
  switch (s.op) {
    case 'table.add':
      return `Add a table called ${q(a.label)}, with a list screen and a menu entry`
    case 'field.add':
      return `Add the field ${q(a.label)} (${String(a.type)}) to ${q(a.table)}`
    case 'field.change':
      return `Change the field ${q(a.field)} on ${q(a.table)}`
    case 'link.add':
      return `Link each ${q(a.table)} record to a ${q(a.to)} record`
    case 'screen.change':
      return `Set up the screen ${q(a.title ?? a.key)}`
    case 'nav.add':
      return `Add ${q(a.label)} to the menu`
    case 'measure.add':
      return `Add the number ${q(a.label)} to Insights`
    case 'automation.add':
      return `Add the automation ${q(a.label)}`
    case 'rule.severity':
      return `Make the check ${q(a.check)} ${String(a.severity)}`
    case 'stage.set':
      return `Change the stages of ${q(a.table)}`
    default:
      return s.op
  }
}

function PlanCard({ plan, canApply, onDone }: { plan: SetupPlan; canApply: boolean; onDone: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [ticked, setTicked] = useState<Set<number>>(() => new Set(plan.steps.flatMap((s, i) => (s.ok ? [i] : []))))
  const apply = useMutation({
    mutationFn: () => ai.setupApply(plan.id, [...ticked].sort((a, b) => a - b)),
    onSuccess: async () => {
      toast({ title: 'Added to the Draft', description: 'Nothing is live yet. Publish from Versions when you are ready.', tone: 'ok' })
      await Promise.all(['studio-status', 'releases', 'studio-nav', 'studio-screens', 'studio-tables', 'live-tables'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      onDone()
    },
  })
  const discard = useMutation({ mutationFn: () => ai.setupDiscard(plan.id), onSuccess: onDone })
  const toggle = (i: number) =>
    setTicked((t) => {
      const n = new Set(t)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })
  return (
    <Card data-testid="setup-plan" aria-label="Proposed plan">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-bold text-ink">The plan</h2>
        <Badge tone="accent">
          <Sparkles className="mr-1 inline size-3" aria-hidden />
          AI plan
        </Badge>
        <span className="text-xs text-muted">Every step was tried and rolled back. Nothing has changed yet.</span>
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {plan.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <input
              id={`step-${i}`}
              type="checkbox"
              className="mt-1 size-4 accent-[var(--accent)]"
              checked={ticked.has(i)}
              disabled={!s.ok || !canApply}
              onChange={() => toggle(i)}
            />
            <label htmlFor={`step-${i}`} className="flex-1">
              <span className="font-semibold text-ink">{describeStep(s)}</span>
              {s.why && <span className="block text-muted">{s.why}</span>}
              {!s.ok && <span className="block text-bad-ink">Will not work: {s.error}</span>}
            </label>
            <Badge tone={s.ok ? 'ok' : 'bad'}>{s.ok ? 'Works' : 'Fails'}</Badge>
          </li>
        ))}
      </ul>
      {apply.error && <div className="mt-3"><AiError error={apply.error} /></div>}
      <div className="mt-4 flex flex-wrap gap-2">
        {canApply ? (
          <Button variant="primary" disabled={ticked.size === 0} loading={apply.isPending} onClick={() => apply.mutate()}>
            Add {ticked.size} step{ticked.size === 1 ? '' : 's'} to the Draft
          </Button>
        ) : (
          <p className="text-sm text-muted">You can plan here, but applying needs permission to edit the app.</p>
        )}
        <Button variant="ghost" loading={discard.isPending} onClick={() => discard.mutate()}>
          Discard plan
        </Button>
      </div>
    </Card>
  )
}

const STARTERS = ['Track our projects with a status', 'Add a table for suppliers', 'What is in my app right now?']

/** Set up by chat. The AI only proposes a plan; the owner ticks, applies and can undo. */
export function SetupChat() {
  const toast = useToast()
  const qc = useQueryClient()
  const state = useQuery({ queryKey: ['ai-setup'], queryFn: ai.setupState, retry: false })
  const [text, setText] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-setup'] })
  const say = useMutation({
    mutationFn: (m: string) => ai.setupSay(m),
    onSuccess: async () => {
      setText('')
      await refresh()
    },
  })
  const undo = useMutation({
    mutationFn: (id: string) => ai.setupUndo(id),
    onSuccess: async () => {
      toast({ title: 'Plan undone', description: 'The Draft is back as it was.', tone: 'ok' })
      await Promise.all(['studio-status', 'releases', 'studio-nav', 'studio-screens', 'studio-tables', 'live-tables'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      await refresh()
    },
  })
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' })
  }, [state.data?.messages.length])
  if (state.isLoading) return <LoadingState label="Opening setup chat" />
  if (state.isError || !state.data) return <ErrorState onRetry={() => void state.refetch()} />
  const d = state.data
  if (!d.enabled || !d.available)
    return (
      <EmptyState title={d.available ? 'AI is switched off' : 'No AI provider is set up'}>
        {d.available ? 'Turn AI on in Settings → AI to set up by chat.' : 'Ask whoever runs this workspace to add an AI provider key.'}
      </EmptyState>
    )
  const send = () => {
    const m = text.trim()
    if (m && !say.isPending) say.mutate(m)
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4" data-testid="setup-chat">
      <p className="text-sm text-body">
        Describe what you want in your own words. The AI proposes a plan; <b>you</b> choose what to apply. It never sees your records, writes no code, and nothing goes live until you publish.
      </p>
      <div role="log" aria-label="Setup conversation" aria-live="polite" className="flex flex-col gap-2">
        {d.messages.length === 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Ideas">
            {STARTERS.map((s) => (
              <Button key={s} size="sm" variant="secondary" onClick={() => setText(s)}>
                {s}
              </Button>
            ))}
          </div>
        )}
        {d.messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'self-end rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent-ink' : 'self-start rounded-lg border border-line bg-surface px-3 py-2 text-sm text-body'}>
            <span className="sr-only">{m.role === 'user' ? 'You: ' : 'Assistant: '}</span>
            {m.content}
          </div>
        ))}
        {say.isPending && <p className="text-sm text-muted">Thinking…</p>}
        <div ref={end} />
      </div>
      {say.error && <AiError error={say.error} />}
      {d.open_plan && <PlanCard key={d.open_plan.id} plan={d.open_plan} canApply={d.can_apply} onDone={() => void refresh()} />}
      {d.undoable && d.can_apply && (
        <Card data-testid="setup-applied">
          <p className="text-sm text-body">
            <b className="text-ink">Applied to the Draft:</b> {d.undoable.steps.length} step{d.undoable.steps.length === 1 ? '' : 's'} for “{d.undoable.request}”.
          </p>
          {undo.error && <AiError error={undo.error} />}
          <Button className="mt-2" size="sm" variant="secondary" loading={undo.isPending} onClick={() => undo.mutate(d.undoable!.id)}>
            <Undo2 className="size-4" aria-hidden /> Undo this plan
          </Button>
        </Card>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label htmlFor="setup-message" className="text-sm font-semibold text-ink">
          What should change?
        </label>
        <textarea
          id="setup-message"
          rows={3}
          maxLength={1500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          placeholder="For example: track our projects, with a status and an owner"
        />
        <div>
          <Button type="submit" variant="primary" loading={say.isPending} disabled={!text.trim()}>
            Make a plan
          </Button>
        </div>
      </form>
    </div>
  )
}
