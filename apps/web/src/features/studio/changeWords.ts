/** The publish review in plain words: what changed on a field, said the way the Studio says it. */
const FLAG: Record<string, [string, string]> = {
  required: ['Now required', 'No longer required'],
  hidden: ['Now hidden', 'No longer hidden'],
  unique: ['Duplicates are now refused', 'Duplicates are allowed again'],
  searchable: ['Now found by search', 'No longer found by search'],
  filterable: ['Now offered as a filter', 'No longer offered as a filter'],
}
const q = (v: unknown) => (v === null || v === undefined || v === '' ? 'nothing' : `“${String(v)}”`)
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === 'object' && x ? String((x as { name?: string }).name ?? JSON.stringify(x)) : String(x))) : [])
const count = (v: unknown) => (Array.isArray(v) ? v.length : 0)

export function describeFieldChange(attr: string, from: unknown, to: unknown): string {
  const flag = FLAG[attr]
  if (flag) return to ? flag[0] : flag[1]
  switch (attr) {
    case 'label': return `Label ${q(from)} → ${q(to)}`
    case 'type': return `Type ${q(from)} → ${q(to)}`
    case 'type_name': return `Type name ${q(from)} → ${q(to)}`
    case 'group': return `Moved from group ${q(from)} to ${q(to)}`
    case 'help': return 'Help text changed'
    case 'max_length': return `Length limit ${from ?? 'none'} → ${to ?? 'none'}`
    case 'min': return `Lowest value ${from ?? 'none'} → ${to ?? 'none'}`
    case 'max': return `Highest value ${from ?? 'none'} → ${to ?? 'none'}`
    case 'save_as': return to === 'upper' ? 'Saved in capitals' : to === 'lower' ? 'Saved in small letters' : 'No longer changes letter case'
    case 'default': return `Starting value ${q(from)} → ${q(to)}`
    case 'ref_table': return `Points to ${q(to)}`
    case 'options': {
      const a = new Set(list(from))
      const b = new Set(list(to))
      const added = [...b].filter((x) => !a.has(x))
      const removed = [...a].filter((x) => !b.has(x))
      return ['Choices', added.length ? `added ${added.map(q).join(', ')}` : '', removed.length ? `removed ${removed.map(q).join(', ')}` : ''].filter(Boolean).join(': ').replace(': removed', '; removed')
    }
    case 'rules': return `Validation rules ${count(from)} → ${count(to)}`
    case 'transforms': return `Transformation rules ${count(from)} → ${count(to)}`
    default: return `${attr} changed`
  }
}

/** Table-level changes, which the server names by key. */
export const describeTableAttribute = (a: string) =>
  ({ features: 'Table features changed', 'field order': 'Field order changed', label: 'Table name changed' })[a] ?? `${a} changed`
