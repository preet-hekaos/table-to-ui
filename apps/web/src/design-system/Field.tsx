import { cloneElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from './cn'

const control =
  'h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted disabled:bg-soft aria-[invalid=true]:border-bad'

interface FieldProps {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>
}

/** Label + control + hint + error, wired together for screen readers. */
export function Field({ label, hint, error, required, children }: FieldProps) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-ink">
        {label}
        {required && (
          <span aria-hidden className="text-bad">
            {' '}
            *
          </span>
        )}
      </label>
      {cloneElement(children, { id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-bad-ink">
          {error}
        </p>
      )}
    </div>
  )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cn(control, className)} {...props}>
      {children}
    </select>
  )
}
