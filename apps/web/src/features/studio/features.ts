import type { TableDef } from '@/api/types'

export interface StatCard {
  kind: 'count' | 'number' | 'value'
  field?: string | null
  measure?: 'sum' | 'avg' | 'min' | 'max' | null
  value?: string | null
  label?: string | null
}

export interface TableFeatures {
  sort_filter: boolean
  unsortable: string[]
  unfilterable: string[]
  default_sort: { field: string; direction: 'asc' | 'desc' } | null
  select_bulk: boolean
  bulk_actions: ('export' | 'edit' | 'delete')[]
  bulk_scope: 'view' | 'all'
  import_data: boolean
  export_data: boolean
  export_formats: ('csv' | 'json' | 'xlsx')[]
  export_email: boolean
  inline_edit: boolean
  grouping: boolean
  statistics: boolean
  stat_fields: string[] | null
  stat_cards: StatCard[] | null
  stat_scope: 'search' | 'table'
  default_columns: string[] | null
  density: 'compact' | 'comfortable'
  uneditable: string[]
  ungroupable: string[]
  unexported: string[]
  nobulk: string[]
  row_order: boolean
}

/** Every feature is on until the owner switches it off. Mirrors `TableFeatures` on the server. */
export const DEFAULT_FEATURES: TableFeatures = {
  sort_filter: true,
  unsortable: [],
  unfilterable: [],
  default_sort: null,
  select_bulk: true,
  bulk_actions: ['export', 'edit', 'delete'],
  bulk_scope: 'view',
  import_data: true,
  export_data: true,
  export_formats: ['csv', 'json', 'xlsx'],
  export_email: true,
  inline_edit: true,
  grouping: true,
  statistics: true,
  stat_fields: null,
  stat_cards: null,
  stat_scope: 'search',
  default_columns: null,
  density: 'compact',
  uneditable: [],
  ungroupable: [],
  unexported: [],
  nobulk: [],
  row_order: true,
}

export const featuresOf = (t?: Pick<TableDef, 'features'> | null): TableFeatures => ({ ...DEFAULT_FEATURES, ...(t?.features ?? {}) })

/** Features whose behaviour is live on the real screens. Each part of step 5 adds its own. */
export const ACTIVE_FEATURES = new Set<keyof TableFeatures>(['sort_filter', 'select_bulk', 'import_data', 'export_data', 'inline_edit', 'grouping', 'statistics', 'row_order'])
