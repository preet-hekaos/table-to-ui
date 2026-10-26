import { Check, CircleMinus, FlaskConical, Pencil } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

export type Stage = 'draft' | 'test' | 'live' | 'removed'

export const STAGES: Record<Stage, { label: string; meaning: string; Icon: typeof Pencil; badge: string; stripe: string; dot: string }> = {
  draft: {
    label: 'Draft',
    meaning: 'Changed since the last Test version. Only you and your team see it.',
    Icon: Pencil,
    badge: 'bg-stage-draft-soft text-stage-draft-ink',
    stripe: 'border-l-4 border-l-stage-draft',
    dot: 'bg-stage-draft',
  },
  test: {
    label: 'Test',
    meaning: 'In the Test version, not yet Live.',
    Icon: FlaskConical,
    badge: 'bg-stage-test-soft text-stage-test-ink',
    stripe: 'border-l-4 border-l-stage-test',
    dot: 'bg-stage-test',
  },
  live: {
    label: 'Live',
    meaning: 'The same as what people use now.',
    Icon: Check,
    badge: 'bg-stage-live-soft text-stage-live-ink',
    stripe: 'border-l-4 border-l-stage-live',
    dot: 'bg-stage-live',
  },
  removed: {
    label: 'Removed',
    meaning: 'Deleted in the Draft. It goes away when the Draft is published.',
    Icon: CircleMinus,
    badge: 'bg-stage-removed-soft text-stage-removed-ink',
    stripe: 'border-l-4 border-l-stage-removed',
    dot: 'bg-stage-removed',
  },
}

/** The stage as a word and an icon on its own colour, so colour is never the only signal. */
export function StageBadge({ stage, isNew, className, ...props }: { stage: Stage; isNew?: boolean } & HTMLAttributes<HTMLSpanElement>) {
  const s = STAGES[stage]
  return (
    <span
      className={cn('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap', s.badge, className)}
      title={s.meaning}
      data-stage={stage}
      {...props}
    >
      <s.Icon className="size-3" aria-hidden />
      {s.label}
      {stage === 'draft' && isNew ? ' · new' : ''}
    </span>
  )
}

/** A small coloured dot with a text alternative, for tight lists. */
export function StageDot({ stage, className }: { stage: Stage; className?: string }) {
  const s = STAGES[stage]
  return <span role="img" aria-label={s.label} title={s.label} data-stage={stage} className={cn('inline-block size-2 shrink-0 rounded-full', s.dot, className)} />
}

/** The class that draws a stage colour down the left edge of a row or card. */
export const stageStripe = (stage?: Stage) => (stage ? STAGES[stage].stripe : '')
