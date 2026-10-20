import type { ReactNode } from 'react'
import type { TableDef } from '@/api/types'
import type { RecordRef } from '@/api/types'
import { Card, CardTitle } from '@/design-system'
import { formatField } from './format'

export function formatValue(v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-muted">Not set</span>
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

/** Pattern: a record's fields grouped as the pack defines them. */
export function ProfileFields({ table, data, refs }: { table: TableDef; data: Record<string, unknown>; refs?: Record<string, RecordRef> }) {
  const groups = table.groups.length ? table.groups : [{ key: '_', label: 'Details' }]
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((g) => {
        const fields = table.fields.filter((f) => (table.groups.length ? f.group === g.key : true))
        if (!fields.length) return null
        return (
          <Card key={g.key}>
            <CardTitle>{g.label}</CardTitle>
            <dl className="grid grid-cols-[10rem_1fr] gap-x-3 gap-y-2 text-sm">
              {fields.filter((f) => !f.hidden).map((f) => (
                <div key={f.key} className="contents">
                  <dt className="text-muted">{f.label}</dt>
                  <dd className="text-ink">{formatField(f, data[f.key], refs?.[f.key])}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )
      })}
    </div>
  )
}
