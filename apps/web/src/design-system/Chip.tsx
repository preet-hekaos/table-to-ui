import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from './cn'
import { Tooltip } from './Tooltip'

/**
 * A toggle shown as a rounded chip: soft accent with a tick when on, outlined and quiet when off.
 * It is a checkbox (or a switch) for assistive technology, and `hint` explains it on hover or focus.
 */
export function Chip({
  checked,
  onChange,
  children,
  hint,
  disabled,
  role = 'checkbox',
  label,
  className,
}: {
  checked: boolean
  onChange: (on: boolean) => void
  children: ReactNode
  hint?: string
  disabled?: boolean
  role?: 'checkbox' | 'switch'
  /** Accessible name when it differs from the text shown. */
  label?: string
  className?: string
}) {
  return (
    <Tooltip text={hint}>
      <button
        type="button"
        role={role}
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
          checked ? 'border-accent/40 bg-accent-soft text-accent-ink' : 'border-line bg-surface text-body hover:bg-soft',
          disabled && 'cursor-not-allowed border-dashed bg-canvas text-muted hover:bg-canvas',
          className,
        )}
      >
        {checked && <Check className="size-3" aria-hidden />}
        {children}
      </button>
    </Tooltip>
  )
}
