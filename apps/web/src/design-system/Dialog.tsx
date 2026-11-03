import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogClose = RadixDialog.Close

export function DialogContent({ title, description, children, wide }: { title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-ink/40" />
      <RadixDialog.Content className={`fixed top-1/2 left-1/2 ${wide ? "w-[min(56rem,calc(100vw-2rem))]" : "w-[min(32rem,calc(100vw-2rem))]"} -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-lg bg-surface p-5 shadow-pop`}>
        <RadixDialog.Title className="text-base font-bold text-ink">{title}</RadixDialog.Title>
        <RadixDialog.Description className={description ? 'mt-1 text-sm text-muted' : 'sr-only'}>
          {description ?? title}
        </RadixDialog.Description>
        <div className="mt-4">{children}</div>
        <RadixDialog.Close aria-label="Close" className="absolute top-3 right-3 rounded-md p-1 text-muted hover:bg-soft">
          <X className="size-4" aria-hidden />
        </RadixDialog.Close>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}

/**
 * A panel that slides in from the right, for anything the person reads or edits that can grow past the screen: forms,
 * rule lists, long details. Short questions (confirm, rename) stay in the centred Dialog. The header and the footer stay
 * put while the body scrolls. Esc, the ✕ and a click outside all close it.
 */
export function SideContent({
  title,
  description,
  eyebrow,
  meta,
  footer,
  children,
  size = 'md',
  testId,
}: {
  title: string
  description?: string
  /** A small label above the title, such as "Explain · read only". */
  eyebrow?: ReactNode
  /** Badges or other small facts under the title. */
  meta?: ReactNode
  /** Buttons that stay visible at the bottom while the body scrolls. */
  footer?: ReactNode
  children: ReactNode
  /** md ≈ 460px, lg ≈ 720px (two columns, tables). Never wider than the screen. */
  size?: 'md' | 'lg'
  testId?: string
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/20" />
      <RadixDialog.Content
        data-side-panel=""
        data-testid={testId}
        className={`fixed inset-y-0 right-0 z-50 flex flex-col bg-surface shadow-pop focus:outline-none ${size === 'lg' ? 'w-[min(45rem,100vw)]' : 'w-[min(28.75rem,100vw)]'}`}
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-violet-800">{eyebrow}</p>}
            <RadixDialog.Title className="mt-0.5 text-xl font-bold text-ink">{title}</RadixDialog.Title>
            <RadixDialog.Description className={description ? 'mt-1 text-sm text-muted' : 'sr-only'}>{description ?? title}</RadixDialog.Description>
            {meta && <div className="mt-2 flex flex-wrap gap-1.5">{meta}</div>}
          </div>
          <RadixDialog.Close aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-soft">
            <X className="size-4" aria-hidden />
          </RadixDialog.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line px-6 py-3.5">{footer}</div>}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
