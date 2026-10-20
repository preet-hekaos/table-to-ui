import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

const badge = cva('inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-semibold whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-soft text-body',
      ok: 'bg-ok-soft text-ok-ink',
      warn: 'bg-warn-soft text-warn-ink',
      bad: 'bg-bad-soft text-bad-ink',
      accent: 'bg-accent-soft text-accent-ink',
    },
  },
  defaultVariants: { tone: 'neutral' },
})

export function Badge({ tone, className, ...props }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ tone }), className)} {...props} />
}
