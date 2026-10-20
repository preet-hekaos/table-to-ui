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
}
export interface TableDef {
  key: string
  label: string
  plural_label: string
  title_field: string
  groups: { key: string; label: string }[]
  fields: FieldDef[]
  counts?: { key: string; label: string; table: string; via: string; where: Record<string, unknown> }[]
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
}
export interface RuleOutcome {
  rule: string
  check: string
  severity: 'block' | 'warn'
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
  }
}
export interface StudioTable extends TableDef {
  source: 'pack' | 'agency'
  description?: string
  version: number
}
export interface Measure {
  key: string
  label: string
  value: number
  as_of: string | null
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
