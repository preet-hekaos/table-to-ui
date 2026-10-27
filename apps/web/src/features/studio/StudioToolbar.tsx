import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, LibraryBig, MoreHorizontal, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { Button, cn } from '@/design-system'

export type SectionKey = 'chat' | 'data' | 'map' | 'flow' | 'insights' | 'automations' | 'menu' | 'preview' | 'versions'

interface Section {
  key: SectionKey
  label: string
  about: string
}

/** The Studio sections in three groups, in the order a workspace is usually built. */
export const SECTION_GROUPS: Array<{ title: string; items: Section[] }> = [
  {
    title: 'Build',
    items: [
      { key: 'data', label: 'Tables', about: 'Fields, screens and features of each table.' },
      { key: 'map', label: 'Canvas', about: 'See how the tables link together.' },
      { key: 'flow', label: 'Stages & rules', about: 'The steps a record moves through.' },
    ],
  },
  {
    title: 'Automate',
    items: [
      { key: 'automations', label: 'Automations', about: 'Do things when records change.' },
      { key: 'insights', label: 'Insights', about: 'Charts and numbers for the workspace.' },
    ],
  },
  {
    title: 'Ship',
    items: [
      { key: 'menu', label: 'Menu', about: 'What people see in the sidebar.' },
      { key: 'preview', label: 'Preview', about: 'Try the workspace as a user.' },
      { key: 'versions', label: 'Versions', about: 'Review, test and publish changes.' },
    ],
  },
]

export const sectionLabel = (k: SectionKey) => (k === 'chat' ? 'Set up by chat' : SECTION_GROUPS.flatMap((g) => g.items).find((s) => s.key === k)?.label ?? 'Tables')

const panel = 'z-50 rounded-lg border border-line bg-surface p-1 shadow-lg'

/** The one place to move between Studio sections: a button that names where you are and opens the whole map. */
export function SectionSwitcher({ current, onSelect }: { current: SectionKey; onSelect: (k: SectionKey) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm" aria-label={`Section: ${sectionLabel(current)}. Change section`} className="gap-2 bg-accent-soft font-semibold text-accent-ink">
          {sectionLabel(current)}
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} aria-label="Choose a Studio section" className={cn(panel, 'w-[min(44rem,calc(100vw-2rem))] p-3')}>
          <nav aria-label="Studio sections" className="grid gap-4 sm:grid-cols-3">
            {SECTION_GROUPS.map((g) => (
              <div key={g.title} className="flex flex-col gap-1">
                <p className="px-3 text-xs font-bold tracking-wide text-muted uppercase">{g.title}</p>
                {g.items.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-current={s.key === current ? 'true' : undefined}
                    onClick={() => { onSelect(s.key); setOpen(false) }}
                    className={cn('flex flex-col gap-0.5 rounded-md px-3 py-2 text-left', s.key === current ? 'bg-accent-soft' : 'hover:bg-soft')}
                  >
                    <span className={cn('flex items-center justify-between text-sm font-semibold', s.key === current ? 'text-accent-ink' : 'text-ink')}>
                      {s.label}
                      {s.key === current && <Check className="size-4" aria-hidden />}
                    </span>
                    <span className="text-xs text-body">{s.about}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/** The two things that sit apart from the sections: set up by chat, and the less used links. */
export function HeaderActions({ chat, onChat, chatActive }: { chat: boolean; onChat: () => void; chatActive: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex items-center gap-2">
      {chat && (
        <Button variant={chatActive ? 'primary' : 'secondary'} size="sm" aria-pressed={chatActive} onClick={onChat}>
          <Sparkles className="size-4" aria-hidden /> Set up by chat
        </Button>
      )}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <Button variant="secondary" size="sm" aria-label="More Studio links">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="end" sideOffset={6} aria-label="More Studio links" className={cn(panel, 'w-52')}>
            <div role="menu" aria-label="More Studio links">
              <a href="/patterns" role="menuitem" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-body hover:bg-soft">
                <LibraryBig className="size-4" aria-hidden /> Pattern library
              </a>
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
