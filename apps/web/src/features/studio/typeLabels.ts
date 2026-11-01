import type { FieldDef } from '@/api/types'

export const TYPE_LABELS: Record<FieldDef['type'], string> = {
  text: 'Short text',
  long_text: 'Long text',
  email: 'Email address',
  phone: 'Phone number',
  integer: 'Whole number',
  decimal: 'Number with decimals',
  money: 'Amount of money',
  months: 'Duration in months',
  boolean: 'Yes or no',
  date: 'Date',
  select: 'Choice from a list',
  tags: 'List of labels',
  url: 'Web link',
  reference: 'Link to another table',
}
