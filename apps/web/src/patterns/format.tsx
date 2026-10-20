import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { FieldDef, RecordRef } from '@/api/types'
import { Badge } from '@/design-system'

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const date = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

export function formatMonths(n: number): string {
  const y = Math.floor(n / 12)
  const m = n % 12
  return [y ? `${y} yr${y === 1 ? '' : 's'}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '0 mo'
}

export function formatMoney(n: number): string {
  return inr.format(n)
}

export function formatDate(s: string): string {
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : date.format(d)
}

const empty = <span className="text-muted">Not set</span>

/** One value, shown the way its business type reads naturally. */
export function formatField(f: FieldDef | undefined, v: unknown, ref?: RecordRef): ReactNode {
  if (v === null || v === undefined || v === '') return empty
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (!f) return String(v)
  switch (f.type) {
    case 'money':
      return formatMoney(Number(v))
    case 'months':
      return formatMonths(Number(v))
    case 'date':
      return formatDate(String(v))
    case 'tags':
      return Array.isArray(v) && v.length ? (
        <span className="flex flex-wrap gap-1">{v.map((t) => <Badge key={String(t)} tone="neutral">{String(t)}</Badge>)}</span>
      ) : empty
    case 'reference':
      return ref ? (
        <Link to="/records/$table/$id" params={{ table: ref.table, id: ref.id }} className="text-accent-ink underline">
          {ref.label ?? 'Open'}
        </Link>
      ) : String(v)
    default:
      return String(v)
  }
}
