import type { TypePreset, TypePresets } from '@/api/endpoints'
import type { FieldDef } from '@/api/types'
import { TYPE_LABELS } from './typeLabels'

/** One thing the Type picker can offer: a real-world preset (PAN, Mobile) or a plain core type. */
export interface TypeChoice {
  id: string // "preset:pan_in" or "core:text"
  name: string
  core: FieldDef['type']
  tile: string // two or three characters shown on the tile
  group: 'common' | 'area' | 'other'
  preset?: TypePreset
  description: string
}

const TILES: Record<FieldDef['type'], string> = {
  text: 'Aa', long_text: '¶', email: '@', phone: '+91', integer: '#', decimal: '0.0', money: '₹', months: 'y·m',
  boolean: 'Y/N', date: 'Date', select: '▾', tags: '[ ]', url: '↗', reference: '⇄',
}
const COMMON: FieldDef['type'][] = ['text', 'long_text', 'date', 'boolean', 'select']
const CORE_DESCRIPTION: Record<FieldDef['type'], string> = {
  text: 'Free text on one line', long_text: 'Free text over several lines', email: 'One email address', phone: 'A phone number saved as +country digits',
  integer: 'A whole number', decimal: 'A number with decimals', money: 'An amount of money', months: 'A duration kept as whole months', boolean: 'Yes or no',
  date: 'A calendar date', select: 'One choice from a list you define', tags: 'A list of short labels', url: 'A web address', reference: 'A link to a record of another table',
}

export const coreTypes = Object.keys(TYPE_LABELS) as FieldDef['type'][]
export const tileOf = (t: FieldDef['type']) => TILES[t]

/** All choices, grouped as board 2 shows them: commonly used, this workspace's area, everything else. */
export function buildChoices(data: TypePresets | undefined, areaName: string): TypeChoice[] {
  const core: TypeChoice[] = coreTypes.map((t) => ({
    id: `core:${t}`, name: TYPE_LABELS[t], core: t, tile: TILES[t], group: COMMON.includes(t) ? 'common' : 'other', description: CORE_DESCRIPTION[t],
  }))
  const presets: TypeChoice[] = (data?.presets ?? []).map((p) => ({
    id: `preset:${p.key}`, name: p.name, core: p.core, tile: presetTile(p), group: 'area', preset: p, description: p.description,
  }))
  void areaName
  const rank = (c: TypeChoice) => (c.preset ? -c.preset.used : 0)
  const order = (list: TypeChoice[]) => [...list].sort((a, b) => rank(a) - rank(b))
  return [...order(core.filter((c) => c.group === 'common')), ...order(presets), ...core.filter((c) => c.group === 'other')]
}

function presetTile(p: TypePreset): string {
  const k = p.key
  if (k === 'pan_in') return 'PAN'
  if (k === 'mobile_in') return '+91'
  if (k === 'pincode_in') return 'PIN'
  if (k === 'annual_salary') return '₹'
  if (k === 'experience') return 'y·m'
  if (k === 'notice_days') return '#'
  return TILES[p.core]
}

/** The choice that matches a field today: its preset name when it has one, otherwise its core type. */
export function currentChoice(choices: TypeChoice[], f: Pick<FieldDef, 'type' | 'type_name'>): TypeChoice | undefined {
  if (f.type_name) {
    const hit = choices.find((c) => c.preset?.name === f.type_name)
    if (hit) return hit
  }
  return choices.find((c) => c.id === `core:${f.type}`)
}
