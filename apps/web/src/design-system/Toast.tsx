import * as RadixToast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'ok' | 'bad' | 'neutral'
interface ToastItem {
  id: number
  title: string
  description?: string
  tone: Tone
  /** One button on the toast, such as Undo. The toast stays longer while it has one. */
  action?: { label: string; onClick: () => void }
}
const ToastContext = createContext<(t: Omit<ToastItem, 'id'>) => void>(() => undefined)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const push = useCallback((t: Omit<ToastItem, 'id'>) => setItems((cur) => [...cur, { ...t, id: Date.now() + Math.random() }]), [])
  return (
    <ToastContext.Provider value={push}>
      <RadixToast.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((t) => (
          <RadixToast.Root
            key={t.id}
            duration={t.action ? 15000 : undefined}
            onOpenChange={(open) => !open && setItems((cur) => cur.filter((x) => x.id !== t.id))}
            className={cn(
              'rounded-lg border bg-surface p-3 shadow-pop',
              t.tone === 'ok' && 'border-ok',
              t.tone === 'bad' && 'border-bad',
              t.tone === 'neutral' && 'border-line',
            )}
          >
            <RadixToast.Title className="text-sm font-semibold text-ink">{t.title}</RadixToast.Title>
            {t.description && <RadixToast.Description className="text-xs text-muted">{t.description}</RadixToast.Description>}
            {t.action && (
              <RadixToast.Action altText={t.action.label} asChild>
                <button type="button" onClick={t.action.onClick} className="mt-2 min-h-6 rounded-md border border-line px-3 py-1 text-xs font-semibold text-accent-ink hover:bg-soft">
                  {t.action.label}
                </button>
              </RadixToast.Action>
            )}
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
