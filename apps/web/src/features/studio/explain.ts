import type { FieldDef, StudioTable, TransformRule } from '@/api/types'
import type { FieldAbout } from '@/api/endpoints'
import { ticksOf } from './FeaturesCell'
import type { TableFeatures } from './features'
import { CASES, DO, WHEN } from './transforms'
import { TYPE_LABELS } from './typeLabels'

export interface ExplainSection {
  id: string
  title: string
  lines: { text: string; muted?: boolean }[]
}

export interface Explanation {
  summary: string
  sections: ExplainSection[]
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

function sayTransform(r: TransformRule): string {
  const when = WHEN.find((w) => w.key === r.when)?.label ?? r.when
  const act = DO.find((d) => d.key === r.do)
  const arg = r.args.filter(Boolean).join(', ')
  const how =
    r.do === 'case' ? (CASES.find((c) => c.key === r.value)?.label ?? r.value)
    : r.do === 'set' || r.do === 'set_standard' || r.do === 'copy_field' || r.do === 'remove_chars' ? r.value
    : ''
  return `When the value ${when}${arg ? ` ${arg}` : ''}: ${act?.label ?? r.do}${how ? ` ${how}` : ''}.`
}

/**
 * Plain facts about one field, built only from its own settings, the table's settings and what the server counted.
 * No AI: the same words every time, and they cannot be wrong about the settings.
 */
export function explainField(
  table: StudioTable,
  tables: StudioTable[],
  field: FieldDef,
  features: TableFeatures,
  about: FieldAbout | null,
  own: { listless: boolean; columns: string[] | undefined },
): Explanation {
  const typeName = field.type_name ?? TYPE_LABELS[field.type]
  const long = field.type === 'long_text'
  const rules = (field.rules ?? []).filter((r) => r.enabled)
  const transforms = (field.transforms ?? []).filter((r) => r.enabled)
  const ticks = ticksOf(table, features, field, own.listless, own.columns)
  const target = field.ref_table ? (tables.find((t) => t.key === field.ref_table)?.label ?? field.ref_table) : null

  const bits: string[] = [`${field.label} is a ${typeName} field.`]
  if (field.unique) bits.push('Each value must be new, so two records cannot share one.')
  bits.push(field.required ? 'It must be filled in.' : 'It is optional.')
  if (field.hidden) bits.push('It is hidden from screens.')
  const summary = bits.join(' ')

  // What goes in
  const input: ExplainSection['lines'] = [
    { text: `${typeName}${typeName.toLowerCase() === TYPE_LABELS[field.type].toLowerCase() ? '' : ` (core type ${field.type})`}, saved as ${field.key}.` },
  ]
  if (field.max_length) input.push({ text: `Up to ${field.max_length} characters.` })
  if (field.min != null || field.max != null) {
    input.push({ text: field.min != null && field.max != null ? `Between ${field.min} and ${field.max}.` : field.min != null ? `At least ${field.min}.` : `At most ${field.max}.` })
  }
  if (field.options.length) input.push({ text: `Choices: ${list(field.options)}. The first is used when a value is blank.` })
  if (target) input.push({ text: `Points to a record in ${target}.` })
  if (field.default != null && field.default !== '') input.push({ text: `New records start with ${String(field.default)}.` })
  for (const r of rules) input.push({ text: r.kind === 'not_future' ? `${r.name}: the date cannot be in the future. Else: “${r.message}”.` : `${r.name}. Else: “${r.message}”.` })
  input.push({ text: field.required ? 'A record cannot be saved with this blank.' : 'Blank is allowed.', muted: true })

  // What happens to it
  const happens: ExplainSection['lines'] = []
  if (field.save_as) happens.push({ text: field.save_as === 'upper' ? 'Saved in CAPITAL letters.' : 'Saved in lower case.' })
  if (field.normalize) happens.push({ text: 'Spaces and punctuation are tidied before it is compared.' })
  for (const r of transforms) happens.push({ text: sayTransform(r) })
  if (field.unique) happens.push({ text: 'Duplicates are refused.' })
  if (!happens.length) happens.push({ text: 'Saved exactly as typed.', muted: true })

  // Where it shows
  const shown = ticks.filter((t) => t.on && !t.why).map((t) => t.label.toLowerCase())
  const notShown = ticks.filter((t) => !t.on || t.why).map((t) => t.label.toLowerCase())
  const shows: ExplainSection['lines'] = []
  if (shown.length) shows.push({ text: `On: ${list(shown)}.` })
  if (notShown.length) shows.push({ text: `Not on: ${list(notShown)}.`, muted: true })
  if (field.key === table.title_field) shows.push({ text: 'It is the title: it names each record.' })
  if (long) shows.push({ text: 'Long text cannot be sorted, grouped or changed in bulk.', muted: true })

  // What depends on it
  const deps: ExplainSection['lines'] = []
  const stages = (table.workflow?.stages ?? []).filter((s) => s.ask.includes(field.key)).map((s) => s.label ?? s.key)
  if (table.workflow?.field === field.key) deps.push({ text: 'It is the stage field: the pipeline moves records by it.' })
  if (stages.length) deps.push({ text: `Asked when a record moves to ${list(stages)}.` })
  if (about) {
    if (about.screens.length) deps.push({ text: `Screens: ${list(about.screens)}.` })
    if (about.measures.length) deps.push({ text: `Numbers: ${list(about.measures)}.` })
    if (about.automations.length) deps.push({ text: `Automations: ${list(about.automations)}.` })
  }
  if (!deps.length) deps.push({ text: about ? 'Nothing points at it, so removing it breaks no screen, number or automation.' : 'Loading what depends on it…', muted: true })

  // In your data now
  const data: ExplainSection['lines'] = about
    ? about.total === 0
      ? [{ text: 'No records yet.', muted: true }]
      : [{ text: `${plural(about.total, 'record')}: ${about.filled} filled, ${about.total - about.filled} blank (${Math.round(((about.total - about.filled) / about.total) * 100)}% blank).` }]
    : [{ text: 'Counting…', muted: true }]

  return {
    summary,
    sections: [
      { id: 'in', title: 'What goes in', lines: input },
      { id: 'happens', title: 'What happens to it', lines: happens },
      { id: 'shows', title: 'Where it shows', lines: shows },
      { id: 'deps', title: 'What depends on it', lines: deps },
      { id: 'data', title: 'In your data now', lines: data },
    ],
  }
}

export const explainAsText = (label: string, e: Explanation) =>
  [label, e.summary, ...e.sections.flatMap((s) => ['', s.title.toUpperCase(), ...s.lines.map((l) => `- ${l.text}`)])].join('\n')
