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
