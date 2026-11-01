import type { ButtonHTMLAttributes } from 'react'
import { cn } from './cn'

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role'> {
  checked: boolean
  onCheckedChange: (on: boolean) => void
  label: string
}

/** An on/off switch. The label names it for people using a screen reader. */
export function Switch({ checked, onCheckedChange, label, disabled, className, ...rest }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-line',
        className,
      )}
      {...rest}
    >
      <span className={cn('inline-block size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} aria-hidden />
    </button>
  )
}
