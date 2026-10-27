import { useCallback, useState } from 'react'

export type Density = 'compact' | 'comfortable'
export interface TablePrefs {
  /** null: this person has not chosen, so the table's own default applies. */
  density: Density | null
  /** Field keys this person has hidden from the table. */
  hidden: string[]
  /** Field keys this person has added on top of the table's default columns. */
  added: string[]
  pageSize: number
}

const DEFAULTS: TablePrefs = { density: null, hidden: [], added: [], pageSize: 25 }
const key = (table: string) => `tableui.table.${table}`

/** What this person chose for one table, or the defaults when nothing is saved or storage is blocked. */
export function readPrefs(table: string): TablePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(key(table)) ?? '{}') as Partial<TablePrefs>
    return {
      density: v.density === 'comfortable' || v.density === 'compact' ? v.density : null,
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((x) => typeof x === 'string') : [],
      added: Array.isArray(v.added) ? v.added.filter((x) => typeof x === 'string') : [],
      pageSize: [15, 25, 50, 100].includes(v.pageSize as number) ? (v.pageSize as number) : DEFAULTS.pageSize,
    }
  } catch {
    return DEFAULTS
  }
}

/** Per-person table choices (density, hidden columns, rows per page), kept in the browser. */
export function useTablePrefs(table: string) {
  const [prefs, setPrefs] = useState<TablePrefs>(() => readPrefs(table))
  const update = useCallback(
    (patch: Partial<TablePrefs>) =>
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
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key(table))
    } catch {
      /* nothing to clear */
    }
    setPrefs((cur) => ({ ...DEFAULTS, pageSize: cur.pageSize }))
  }, [table])
  return { prefs, update, reset }
}
