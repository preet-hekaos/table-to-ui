import { describe, expect, it } from 'vitest'
import type { FieldDef, StudioTable } from '@/api/types'
import { explainAsText, explainField } from './explain'
import { featuresOf } from './features'

const field = (over: Partial<FieldDef> = {}): FieldDef => ({
  key: 'pan_no', label: 'PAN number', type: 'text', required: false, group: null, options: [], default: null, min: null, max: null,
  max_length: 10, normalize: null, unique: true, type_name: 'PAN (India)', save_as: 'upper',
  rules: [{ name: 'PAN format', kind: 'pattern', pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$', message: 'Enter a valid PAN', enabled: true }],
  ...over,
})
const table = (f: FieldDef): StudioTable => ({ key: 'candidate', label: 'Candidate', plural_label: 'Candidates', title_field: 'full_name', groups: [], fields: [f], source: 'pack', version: 1 })
const none = { total: 128, filled: 94, screens: ['Candidate list'], measures: [], automations: [] }
const own = { listless: false, columns: undefined }

describe('explainField', () => {
  it('says what the field is from its own settings', () => {
    const f = field()
    const e = explainField(table(f), [table(f)], f, featuresOf(table(f)), none, own)
    expect(e.summary).toBe('PAN number is a PAN (India) field. Each value must be new, so two records cannot share one. It is optional.')
    const text = explainAsText(f.label, e)
    expect(text).toContain('Up to 10 characters.')
    expect(text).toContain('PAN format. Else: “Enter a valid PAN”.')
    expect(text).toContain('Saved in CAPITAL letters.')
    expect(text).toContain('Duplicates are refused.')
    expect(text).toContain('Screens: Candidate list.')
    expect(text).toContain('94 filled, 34 blank (27% blank)')
  })
  it('says when nothing points at the field and when there is no data', () => {
    const f = field({ unique: false, rules: [], save_as: null, required: true })
    const e = explainField(table(f), [table(f)], f, featuresOf(table(f)), { total: 0, filled: 0, screens: [], measures: [], automations: [] }, own)
    const text = explainAsText(f.label, e)
    expect(text).toContain('removing it breaks no screen')
    expect(text).toContain('No records yet.')
    expect(text).toContain('A record cannot be saved with this blank.')
    expect(text).toContain('Saved exactly as typed.')
  })
  it('shows loading lines until the server counts arrive, and the features that are off', () => {
    const f = field({ rules: [] })
    const t = { ...table(f), features: { sortable: false } as never }
    const text = explainAsText(f.label, explainField(t, [t], f, featuresOf(t), null, own))
    expect(text).toContain('Counting…')
    expect(text).toContain('Not on:')
    expect(text).toContain('sortable')
  })
})
