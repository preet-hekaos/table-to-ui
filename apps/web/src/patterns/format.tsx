import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { FieldDef, RecordRef, TableDef } from '@/api/types'
import { Badge } from '@/design-system'

let regional = { currency: 'INR', locale: 'en-IN' }
let money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
let date = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

/** The workspace's regional settings (S07). Called by the app frame once they load. */
export function setRegional(r: { currency?: string; locale?: string }) {
  const next = { currency: r.currency || 'INR', locale: r.locale || 'en-IN' }
  if (next.currency === regional.currency && next.locale === regional.locale) return
  regional = next
  try {
    money = new Intl.NumberFormat(next.locale, { style: 'currency', currency: next.currency, maximumFractionDigits: 0 })
    date = new Intl.DateTimeFormat(next.locale, { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    /* an unknown locale keeps the previous formats */
  }
}

export function formatMonths(n: number): string {
  const y = Math.floor(n / 12)
  const m = n % 12
  return [y ? `${y} yr${y === 1 ? '' : 's'}` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ') || '0 mo'
}

/** ₹12,50,000 · 12.5 LPA in India; plain currency elsewhere. */
export function formatMoney(n: number): string {
  const base = money.format(n)
  if (regional.currency !== 'INR' || Math.abs(n) < 100000) return base
  const lpa = Math.round((n / 100000) * 10) / 10
  return `${base} · ${lpa} LPA`
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

/** A table's visible fields in the groups the pack defines; fields in no group (for example ones a
 *  builder added) come last under "More details". */
export function fieldGroups(table: TableDef): { key: string; label: string; fields: FieldDef[] }[] {
  const shown = table.fields.filter((f) => !f.hidden)
  if (!table.groups.length) return [{ key: '_', label: 'Details', fields: shown }]
  const known = new Set(table.groups.map((g) => g.key))
  const out = table.groups.map((g) => ({ key: g.key, label: g.label, fields: shown.filter((f) => f.group === g.key) }))
  const rest = shown.filter((f) => !f.group || !known.has(f.group))
  if (rest.length) out.push({ key: '_more', label: 'More details', fields: rest })
  return out.filter((g) => g.fields.length)
}
