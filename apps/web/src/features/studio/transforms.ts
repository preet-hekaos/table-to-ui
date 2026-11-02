import type { FieldDef, TransformDo, TransformRule, TransformWhen } from '@/api/types'

export const WHEN: { key: TransformWhen; label: string; palette: string }[] = [
  { key: 'blank', label: 'is blank', palette: 'is blank' },
  { key: 'equals_any', label: 'equals any of', palette: 'equals any of' },
  { key: 'contains', label: 'contains', palette: 'contains' },
  { key: 'starts_with', label: 'starts with', palette: 'starts with' },
  { key: 'ends_with', label: 'ends with', palette: 'ends with' },
  { key: 'matches', label: 'matches a pattern', palette: 'matches a pattern' },
  { key: 'above', label: 'is above', palette: 'is above or below' },
  { key: 'below', label: 'is below', palette: '' },
  { key: 'field_is', label: 'another field is …', palette: 'another field is …' },
]
export const DO: { key: TransformDo; label: string; palette: string }[] = [
  { key: 'set', label: 'set to a value', palette: 'set to a value' },
  { key: 'set_standard', label: 'set to a standard value', palette: 'set to a standard value' },
  { key: 'copy_field', label: 'copy another field', palette: 'copy another field' },
  { key: 'keep_match', label: 'keep the part that matched', palette: 'keep the part that matched' },
  { key: 'trim', label: 'trim spaces', palette: 'trim spaces' },
  { key: 'case', label: 'lower, UPPER or Title Case', palette: 'lower, UPPER or Title Case' },
  { key: 'remove_chars', label: 'remove characters', palette: 'remove characters' },
  { key: 'clear', label: 'clear the value', palette: 'clear the value' },
]
export const CASES = [
  { key: 'lower', label: 'lower case' },
  { key: 'upper', label: 'UPPER CASE' },
  { key: 'title', label: 'Title Case' },
]

export const emptyRule = (when: TransformWhen = 'blank', d: TransformDo = 'set'): TransformRule => ({
  when,
  args: [],
  do: d,
  value: d === 'case' ? 'title' : '',
  stop: false,
  enabled: true,
})

/** A rule the server will accept: every part it needs is filled in. Half-built rows are kept on screen but never sent. */
export function isComplete(r: TransformRule): boolean {
  const a = r.args.filter((x) => x.trim() !== '')
  const whenOk =
    r.when === 'blank' ||
    (r.when === 'field_is' ? a.length >= 2 : a.length >= 1) ||
    false
  const doOk =
    r.do === 'trim' || r.do === 'clear' || r.do === 'keep_match'
      ? true
      : r.do === 'set'
        ? true
        : r.value !== ''
  return whenOk && doOk
}

const q = (s: string) => `“${s}”`

/** The short form shown in the grid and on each rule: "If blank → 30". */
export function describeRule(r: TransformRule, fields: FieldDef[], standard: Record<string, string>): string {
  const label = (k: string) => fields.find((f) => f.key === k)?.label ?? k
  const cond: Record<TransformWhen, string> = {
    blank: 'If blank',
    equals_any: `If ${r.args.map(q).join(' / ') || '…'}`,
    contains: `If contains ${q(r.args[0] ?? '…')}`,
    starts_with: `If starts with ${q(r.args[0] ?? '…')}`,
    ends_with: `If ends with ${q(r.args[0] ?? '…')}`,
    matches: `If matches ${r.args[0] ?? '…'}`,
    above: `If above ${r.args[0] ?? '…'}`,
    below: `If below ${r.args[0] ?? '…'}`,
    field_is: `If ${label(r.args[0] ?? '…')} is ${q(r.args[1] ?? '…')}`,
  }
  const act: Record<TransformDo, string> = {
    set: r.value === '' ? 'empty' : r.value,
    set_standard: standard[r.value] ?? r.value,
    copy_field: `copy ${label(r.value)}`,
    keep_match: 'keep the match',
    trim: 'trim spaces',
    case: CASES.find((c) => c.key === r.value)?.label ?? r.value,
    remove_chars: `remove ${q(r.value)}`,
    clear: 'clear',
  }
  return `${cond[r.when]} → ${act[r.do]}`
}
