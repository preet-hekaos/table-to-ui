import type { ReactNode } from 'react'

/** Centered card used by sign-up, sign-in, MFA and invitation screens. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-full items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2 font-bold text-ink">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-xs text-white" aria-hidden>
            T
          </span>
          Table to UI
        </div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-5">{children}</div>
        {footer && <div className="mt-5 border-t border-line pt-4 text-sm text-muted">{footer}</div>}
      </div>
    </main>
  )
}
