import * as T from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

/** A short explanation on hover or keyboard focus. Works on disabled controls when the trigger is a wrapper. */
export function Tooltip({ text, children }: { text?: string; children: ReactNode }) {
  if (!text) return <>{children}</>
  return (
    <T.Provider delayDuration={150} skipDelayDuration={300}>
      <T.Root>
        <T.Trigger asChild>
          <span className="inline-flex">{children}</span>
        </T.Trigger>
        <T.Portal>
          <T.Content side="top" sideOffset={6} className="z-50 max-w-64 rounded-md bg-ink px-2.5 py-1.5 text-xs leading-snug text-surface shadow-lg">
            {text}
            <T.Arrow className="fill-ink" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  )
}
