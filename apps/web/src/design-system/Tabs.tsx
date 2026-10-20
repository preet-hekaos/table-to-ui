import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentProps } from 'react'
import { cn } from './cn'

export const Tabs = RadixTabs.Root

export function TabsList({ className, ...props }: ComponentProps<typeof RadixTabs.List>) {
  return <RadixTabs.List className={cn('flex gap-1 border-b border-line', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        '-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-muted hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink',
        className,
      )}
      {...props}
    />
  )
}

export const TabsContent = RadixTabs.Content
