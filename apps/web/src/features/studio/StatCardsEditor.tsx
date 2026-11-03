import type { StudioTable } from '@/api/types'
import { Button, Input, Select } from '@/design-system'
import type { StatCard } from './features'

const NUMBER_TYPES = ['integer', 'decimal', 'money', 'months']
const VALUE_TYPES = ['select', 'boolean', 'text']
const MEASURES: [StatCard['measure'], string][] = [['sum', 'Total'], ['avg', 'Average'], ['min', 'Lowest'], ['max', 'Highest']]

/** The summary strip, card by card: how many records, a number measured over a field, or how many hold a value. */
export function StatCardsEditor({ table, cards, canEdit, onChange }: { table: StudioTable; cards: StatCard[]; canEdit: boolean; onChange: (c: StatCard[]) => void }) {
  const numbers = table.fields.filter((x) => NUMBER_TYPES.includes(x.type))
  const choices = table.fields.filter((x) => VALUE_TYPES.includes(x.type))
  const put = (i: number, c: StatCard) => onChange(cards.map((x, j) => (j === i ? c : x)))
  const kindChange = (i: number, kind: StatCard['kind']) => {
    if (kind === 'count') put(i, { kind })
    else if (kind === 'number') put(i, { kind, field: numbers[0]?.key ?? null, measure: 'sum' })
    else put(i, { kind, field: choices[0]?.key ?? null, value: choices[0]?.options?.[0] ?? '' })
  }
  return (
    <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
      <legend className="text-xs text-body">Cards, in order (up to six)</legend>
      {cards.length === 0 && <p className="text-xs text-muted">No cards: nothing is shown above the table.</p>}
      {cards.map((c, i) => {
        const valueField = choices.find((x) => x.key === c.field)
        return (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-canvas p-2" role="group" aria-label={`Card ${i + 1}`}>
            <label className="flex flex-col gap-0.5 text-xs text-body">
              Shows
              <Select aria-label={`Card ${i + 1} shows`} className="w-56" value={c.kind} onChange={(e) => kindChange(i, e.target.value as StatCard['kind'])}>
                <option value="count">How many records</option>
                <option value="number" disabled={numbers.length === 0}>A number field</option>
                <option value="value" disabled={choices.length === 0}>How many have a value</option>
              </Select>
            </label>
            {c.kind === 'number' && (
              <>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Measure
                  <Select aria-label={`Card ${i + 1} measure`} className="w-32" value={c.measure ?? 'sum'} onChange={(e) => put(i, { ...c, measure: e.target.value as StatCard['measure'] })}>
                    {MEASURES.map(([k, l]) => <option key={k} value={k!}>{l}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Field
                  <Select aria-label={`Card ${i + 1} field`} className="w-44" value={c.field ?? ''} onChange={(e) => put(i, { ...c, field: e.target.value })}>
                    {numbers.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </Select>
                </label>
              </>
            )}
            {c.kind === 'value' && (
              <>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Field
                  <Select aria-label={`Card ${i + 1} field`} className="w-44" value={c.field ?? ''} onChange={(e) => { const f2 = choices.find((x) => x.key === e.target.value); put(i, { ...c, field: e.target.value, value: f2?.options?.[0] ?? '' }) }}>
                    {choices.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                  </Select>
                </label>
                <label className="flex flex-col gap-0.5 text-xs text-body">
                  Value
                  {valueField?.options?.length ? (
                    <Select aria-label={`Card ${i + 1} value`} className="w-40" value={c.value ?? ''} onChange={(e) => put(i, { ...c, value: e.target.value })}>
                      {valueField.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : (
                    <Input aria-label={`Card ${i + 1} value`} className="w-40" value={c.value ?? ''} onChange={(e) => put(i, { ...c, value: e.target.value })} />
                  )}
                </label>
              </>
            )}
            <label className="flex flex-col gap-0.5 text-xs text-body">
              Name (optional)
              <Input key={`${i}-${c.label ?? ''}`} aria-label={`Card ${i + 1} name`} className="w-40" maxLength={60} defaultValue={c.label ?? ''} onBlur={(e) => { const v = e.target.value.trim() || null; if (v !== (c.label ?? null)) put(i, { ...c, label: v }) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
            </label>
            <span className="ml-auto flex gap-1">
              <Button type="button" size="sm" variant="ghost" aria-label={`Move card ${i + 1} earlier`} disabled={i === 0} onClick={() => onChange(cards.map((x, j) => (j === i - 1 ? cards[i]! : j === i ? cards[i - 1]! : x)))}>Up</Button>
              <Button type="button" size="sm" variant="ghost" aria-label={`Remove card ${i + 1}`} onClick={() => onChange(cards.filter((_, j) => j !== i))}>Remove</Button>
            </span>
          </div>
        )
      })}
      <div>
        <Button type="button" size="sm" variant="secondary" disabled={cards.length >= 6} onClick={() => onChange([...cards, { kind: 'count' }])}>Add a card</Button>
      </div>
    </fieldset>
  )
}
