/** Shapes of the API's free-form responses (the OpenAPI document types these as plain objects). */
export interface FieldDef {
  key: string
  label: string
  type: 'text' | 'long_text' | 'email' | 'phone' | 'integer' | 'decimal' | 'boolean' | 'date' | 'select' | 'url' | 'money' | 'months' | 'tags' | 'reference'
  required: boolean
  group: string | null
  options: string[]
  default: unknown
  min: number | null
  max: number | null
  max_length: number | null
  normalize: 'text' | 'email' | 'phone' | null
  unique: boolean
  hidden?: boolean
  ref_table?: string | null
  searchable?: boolean
  filterable?: boolean
  source?: 'pack' | 'agency'
  help?: string | null
  /** For a stage field: what each stored stage is called now (stages can be renamed). */
  option_labels?: Record<string, string>
}
export interface TableDef {
  key: string
  label: string
  plural_label: string
  title_field: string
  groups: { key: string; label: string }[]
  fields: FieldDef[]
  counts?: { key: string; label: string; table: string; via: string; where: Record<string, unknown> }[]
  workflow?: { field: string; stages: { key: string; label: string | null; end: boolean; ask: string[] }[]; transitions: Record<string, string[]> } | null
  features?: Partial<import('@/features/studio/features').TableFeatures> | null
}
export interface RecordRef {
  table: string
  id: string
  label: string | null
}
export interface RecordRow {
  refs?: Record<string, RecordRef>
  owner?: { id: string; name: string | null } | null
  counts?: Record<string, number>
  id: string
  table: string
  version: number
  data: Record<string, unknown>
  created_at: string
  updated_at: string
  warnings?: RuleOutcome[]
}
export interface RecordPage {
  items: RecordRow[]
  next_cursor: string | null
  /** Only on numbered pages. */
  total?: number
  page?: number
  page_size?: number
}
export interface RuleOutcome {
  rule: string
  check: string
  severity: 'block' | 'warn' | 'approval'
  overridable?: boolean
  message: string
  link: { table: string; id: string; label: string } | null
}
export interface HistoryEntry {
  seq: number
  action: string
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  actor_name: string | null
  at: string
  app_version: string
}
export interface Me {
  user_id: string
  email: string
  full_name: string
  tenant_id: string | null
  tenant_name: string | null
  role: string | null
  permissions: string[]
  mfa_enabled: boolean
}
export interface ReleaseRow {
  version: number
  release_id: string
  created_at: string
  manifest_hash: string
  is_live: boolean
  is_test: boolean
  manifest: {
    pack: { id: string; version: string }
    tables: Record<string, { version: number; hash: string }>
    rules: Record<string, { version: number; hash: string }>
    measures: Record<string, { version: number; hash: string }>
    automations?: Record<string, { version: number; hash: string }>
  }
}
export interface StudioTable extends TableDef {
  source: 'pack' | 'agency'
  description?: string
  version: number
}
export interface MeasurePoint {
  label: string
  key?: string
  value: number | null
}
export interface Measure {
  key: string
  label: string
  value: number | null
  as_of: string | null
  help: string | null
  display: 'number' | 'trend' | 'bars'
  table: string
  aggregate: 'count' | 'sum' | 'avg' | 'distinct'
  period: boolean
  source: 'pack' | 'agency'
  home: boolean
  series: MeasurePoint[] | null
  unit?: '%' | 'days' | null
  previous?: number | null
  trend?: number[] | null
}
export interface MeasureRecords {
  table: string
  total: number
  shown: number
  capped: boolean
  items: RecordRow[]
  next_cursor: string | null
}
export interface MeasureDraft {
  key: string
  label: string
  table: string
  table_label: string
  aggregate: 'count' | 'sum' | 'avg' | 'distinct'
  field: string | null
  where: { field: string; op: string; value?: string | number | boolean | string[] | null }[]
  group_by: string | null
  time_field: string | null
  by_time: 'day' | 'week' | 'month' | null
  display: 'number' | 'trend' | 'bars'
  help: string | null
  order: number
  hidden: boolean
  home: boolean
  source: 'pack' | 'agency'
  problems: string[]
  fields_turned_on?: string[]
}
export interface TenantRow {
  id: string
  name: string
  plan: string
  cluster: string
  schema: string
  created_at: string
  health: string
  members: number
}
export interface ActivityRow {
  id: number
  action: string
  subject_id: string | null
  at: string
  actor: string | null
}

/** How a builder tuned a screen in the configurator. Every key is optional; patterns fall back to sensible defaults. */
export interface ScreenConfig {
  facets?: string[]
  columns?: string[]
  filters?: string[]
  group_by?: string
  fields?: string[]
  actions?: string[]
  empty_text?: string
}

export interface BoardColumn {
  stage: string
  label: string
  end: boolean
  count: number
  cards: RecordRow[]
  next: string[]
  ask: string[]
}
export interface Board {
  table: string
  field: string
  total: number
  columns: BoardColumn[]
}
export interface HeldChange {
  id: string
  table: string
  action: 'create' | 'update'
  record_id: string | null
  payload: Record<string, unknown>
  checks: RuleOutcome[]
  title: string
  note: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'failed'
  requested_by: string
  requested_by_name: string | null
  requested_at: string
  decided_by_name: string | null
  decided_at: string | null
  decision_note: string | null
  result_record_id: string | null
  error: string | null
}
export interface DuplicatePair {
  a: { id: string; label: string | null; data: Record<string, unknown> }
  b: { id: string; label: string | null; data: Record<string, unknown> }
  score: number
}
export interface MergeRow {
  id: string
  kept: string
  merged: string
  merged_label: string | null
  merged_at: string
  relinked: number
  undone: boolean
  can_undo: boolean
}
