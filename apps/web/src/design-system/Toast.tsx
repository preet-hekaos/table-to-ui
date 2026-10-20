import * as RadixToast from '@radix-ui/react-toast'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { cn } from './cn'

type Tone = 'ok' | 'bad' | 'neutral'
interface ToastItem {
  id: number
  title: string
  description?: string
  tone: Tone
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
          </RadixToast.Root>
        ))}
        <RadixToast.Viewport className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" />
      </RadixToast.Provider>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
