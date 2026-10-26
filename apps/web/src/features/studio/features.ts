import type { TableDef } from '@/api/types'

export interface TableFeatures {
  sort_filter: boolean
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
  row_order: boolean
}

/** Every feature is on until the owner switches it off. Mirrors `TableFeatures` on the server. */
export const DEFAULT_FEATURES: TableFeatures = {
  sort_filter: true,
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
  row_order: true,
}

export const featuresOf = (t?: Pick<TableDef, 'features'> | null): TableFeatures => ({ ...DEFAULT_FEATURES, ...(t?.features ?? {}) })

/** Features whose behaviour is live on the real screens. Each part of step 5 adds its own. */
export const ACTIVE_FEATURES = new Set<keyof TableFeatures>([])
