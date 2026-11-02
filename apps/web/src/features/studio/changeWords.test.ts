import { describe, expect, it } from 'vitest'
import { describeFieldChange, describeTableAttribute } from './changeWords'

describe('the publish review in plain words', () => {
  it('says switches as sentences', () => {
    expect(describeFieldChange('unique', false, true)).toBe('Duplicates are now refused')
    expect(describeFieldChange('required', true, false)).toBe('No longer required')
  })
  it('names what moved', () => {
    expect(describeFieldChange('label', 'Phone', 'Mobile')).toBe('Label “Phone” → “Mobile”')
    expect(describeFieldChange('max_length', null, 10)).toBe('Length limit none → 10')
    expect(describeFieldChange('options', ['A'], ['A', 'B'])).toBe('Choices: added “B”')
    expect(describeFieldChange('transforms', [], [{}, {}])).toBe('Transformation rules 0 → 2')
    expect(describeFieldChange('rules', [{ name: 'x' }], [])).toBe('Validation rules 1 → 0')
  })
  it('names table-wide changes', () => {
    expect(describeTableAttribute('features')).toBe('Table features changed')
    expect(describeTableAttribute('field order')).toBe('Field order changed')
  })
})
