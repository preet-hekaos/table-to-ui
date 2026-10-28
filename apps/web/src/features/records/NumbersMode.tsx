import { ChartNoAxesCombined, LayoutGrid } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Chip, cn } from '@/design-system'
import type { TableFeatures } from '@/features/studio/features'

interface NumbersPrefs {
  view?: 'cards' | 'chart'
  whole?: boolean
}
const key = (t: string) => `tableui.numbers.${t}`

/** What this person chose for the numbers above one table: cards or a chart, and whether they follow the search. */
export function useNumbersPrefs(table: string, feat: TableFeatures) {
  const [prefs, setPrefs] = useState<NumbersPrefs>(() => {
    try {
      return JSON.parse(localStorage.getItem(key(table)) ?? '{}') as NumbersPrefs
    } catch {
      return {}
    }
  })
  const update = useCallback(
    (patch: NumbersPrefs) =>
      setPrefs((cur) => {
        const next = { ...cur, ...patch }
        try {
          localStorage.setItem(key(table), JSON.stringify(next))
        } catch {
          /* private mode: lasts for this visit */
        }
        return next
      }),
    [table],
  )
  return {
    view: prefs.view ?? feat.stat_view,
    whole: prefs.whole ?? feat.stat_scope === 'table',
    setView: (view: 'cards' | 'chart') => update({ view }),
    setWhole: (whole: boolean) => update({ whole }),
  }
}
export type NumbersState = ReturnType<typeof useNumbersPrefs>

/** Cards or chart, and whole table or matching rows: two small controls the person can always change. */
export function NumbersMode({ n }: { n: NumbersState }) {
  return (
    <div className="flex items-center gap-2" data-testid="numbers-mode">
      <Chip checked={n.whole} onChange={n.setWhole} hint="The numbers ignore the search and filters and always cover the whole table.">
        Whole table
      </Chip>
      <div role="radiogroup" aria-label="Show numbers as" className="flex gap-0.5 rounded-xl bg-soft p-[3px]">
        {([['cards', 'Cards', LayoutGrid], ['chart', 'Chart', ChartNoAxesCombined]] as const).map(([k, label, Icon]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={n.view === k}
            aria-label={label}
            title={label}
            onClick={() => n.setView(k)}
            className={cn('flex h-7 w-9 items-center justify-center rounded-lg', n.view === k ? 'bg-surface text-accent-ink shadow-sm' : 'text-body hover:bg-surface')}
          >
            <Icon className="size-[18px]" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}
