/** One function per endpoint. Request shapes are checked against the generated OpenAPI types;
 *  response shapes come from ./types until the API publishes response models for them. */
import { api, unwrap } from './client'
import type {
  ActivityRow,
  HeldChange,
  Board,
  DuplicatePair,
  MergeRow,
  HistoryEntry,
  Measure,
  MeasureDraft,
  MeasureRecords,
  Me,
  RecordPage,
  RecordRow,
  ReleaseRow,
  RuleOutcome,
  FieldDef,
  StudioTable,
  TableDef,
  TenantRow,
} from './types'

const cast = <T>(p: unknown) => unwrap<T>(p as Promise<{ data?: T; error?: unknown; response: Response }>)
type Json = Record<string, unknown>

export const auth = {
  signUp: (body: { agency_name: string; full_name: string; email: string; password: string }) =>
    cast<{ tenant_id: string; token: string }>(api.POST('/v1/auth/signup', { body })),
  signIn: (body: { email: string; password: string }) =>
    cast<{ token: string; mfa_required: boolean; mfa_enrolled: boolean }>(api.POST('/v1/auth/sign-in', { body })),
  verifyMfa: (code: string) => cast<void>(api.POST('/v1/auth/mfa/verify', { body: { code }, parseAs: 'text' })),
  enrolMfa: () => cast<{ secret: string; otpauth_uri: string }>(api.POST('/v1/auth/mfa/enroll')),
  confirmMfa: (code: string) => cast<void>(api.POST('/v1/auth/mfa/confirm', { body: { code }, parseAs: 'text' })),
  signOut: () => cast<void>(api.POST('/v1/auth/sign-out', { parseAs: 'text' })),
  me: () => cast<Me & { mfa_verified: boolean }>(api.GET('/v1/me')),
  invitation: (token: string) =>
    cast<{ state: 'valid' | 'expired' | 'used'; email: string | null; tenant_name: string | null; role: string | null }>(
      api.GET('/v1/invitations/{token}', { params: { path: { token } } }),
    ),
  acceptInvitation: (token: string, body: { full_name: string; password: string }) =>
    cast<{ tenant_id: string; token: string }>(api.POST('/v1/invitations/{token}/accept', { params: { path: { token } }, body })),
  invite: (body: { email: string; role: string }) => cast<{ id: string }>(api.POST('/v1/invitations', { body })),
}

export const workspace = {
  onboarding: () =>
    cast<{
      workspace: string
      step: string
      pack_id: string | null
      packs: { id: string; title: string; description: string; tables: string[]; roles: string[] }[]
    }>(api.GET('/v1/workspace/onboarding' as never)),
  choosePack: (pack_id: string) => cast<{ pack_id: string; step: string }>(api.POST('/v1/workspace/pack' as never, { body: { pack_id } } as never)),
}

const g = <T>(path: string) => cast<T>(api.GET(path as never))
const send = <T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
  const call = (api as never as Record<string, ((p: string, o?: unknown) => Promise<unknown>) | undefined>)[method]
  return cast<T>(call!.call(api, path, body === undefined ? {} : { body }))
}

export interface RangeQuery { range?: string; start?: string; end?: string }

export interface RoleRow { key: string; name: string; description: string; members: number; grants: string[]; scopes: Record<string, string>; field_deny: string[] }
export interface PersonRow { id: string; email: string; full_name: string; active: boolean; role: string; teams: string[] }
export interface TeamRow { id: string; name: string; members: string[] }
export interface WorkspaceSettings { brand: { app_name: string; accent: string; logo_file_id: string | null }; regional: Record<string, string> }

export const admin = {
  home: () => g<{ workspace: string; pack_id: string | null; pack_version: string | null; release_version: number | null; checklist: { key: string; label: string; done: boolean; to: string }[]; pack_updates: { pack_id: string; version: string; title: string; from: string }[] }>('/v1/workspace/home'),
  people: () => g<PersonRow[]>('/v1/workspace/people'),
  setActive: (id: string, active: boolean) => send<void>('POST', `/v1/workspace/people/${id}/${active ? 'activate' : 'deactivate'}`),
  setRole: (id: string, role: string) => send<void>('PUT', `/v1/workspace/people/${id}/role`, { role }),
  removePerson: (id: string) => send<void>('DELETE', `/v1/workspace/people/${id}`),
  teams: () => g<TeamRow[]>('/v1/workspace/teams'),
  createTeam: (name: string) => send<TeamRow>('POST', '/v1/workspace/teams', { name }),
  setMembers: (id: string, user_ids: string[]) => send<void>('PUT', `/v1/workspace/teams/${id}/members`, { user_ids }),
  roles: () => g<RoleRow[]>('/v1/workspace/roles'),
  saveRole: (r: Omit<RoleRow, 'members'>, isNew: boolean) =>
    send<void>(isNew ? 'POST' : 'PUT', isNew ? '/v1/workspace/roles' : `/v1/workspace/roles/${r.key}`, r),
  settings: () => g<WorkspaceSettings>('/v1/workspace/settings'),
  acceptUpdate: (version: string) => send<{ version: string; changes: Record<string, string[]> }>('POST', `/v1/workspace/pack/updates/${version}/accept`),
  saveBrand: (b: { app_name: string; accent: string; logo_file_id?: string | null }) => send<WorkspaceSettings['brand']>('PUT', '/v1/workspace/settings/brand', b),
  saveRegional: (r: Record<string, string>) => send<Record<string, string>>('PUT', '/v1/workspace/settings/regional', r),
}

export interface Link {
  id: string
  table: string
  table_label: string
  field: string
  label: string
  to: string
  to_label: string
  required: boolean
  hidden: boolean
  help: string | null
  source: 'pack' | 'agency'
  used: number
  empty: number
  total: number
}

export interface LinkIssue {
  kind: string
  severity: 'problem' | 'warning' | 'note'
  link: string | null
  message: string
}

export interface AutomationAction { kind: 'create' | 'notify' | 'set_field'; to: 'owner' | 'role'; role?: string | null; message: string; also_email: boolean; table?: string | null; values: Record<string, string>; field?: string | null; value?: string | null }
export interface AutomationDraft {
  key: string
  label: string
  help: string
  trigger: { kind: 'created' | 'updated' | 'changed' | 'date'; table: string; field?: string | null; value?: string | null; days: number }
  where: { field: string; op: string; value?: string | number | boolean | null }[]
  actions: AutomationAction[]
  enabled: boolean
  order: number
  source: 'pack' | 'agency'
  table_label: string
  problems: string[]
}
export interface AutomationRun { id: string; automation: string; label: string; table: string; record_id: string; status: 'done' | 'retrying' | 'failed'; attempts: number; error: string | null; did: string[]; at: string }
export interface Notice { id: string; kind: string; title: string; link: string | null; created_at: string; read: boolean }
export interface NotificationPrefs { kinds: { kind: string; label: string; channel: 'in_app' | 'in_app_email' | 'off' }[]; digest: boolean }
export interface Needs {
  tasks: { table: string; label: string; total: number; items: { id: string; title: string; due_on: string | null; overdue: boolean; can_finish: boolean }[] } | null
  approvals: number
  unread: number
}
export interface Guide { title: string; steps: { key: string; title: string; help: string; path: string; done: boolean }[]; done: number; total: number; dismissed: boolean }

export const notifications = {
  inbox: () => g<{ unread: number; items: Notice[] }>('/v1/notifications'),
  read: (ids?: string[]) => send<{ marked: number; unread: number }>('POST', '/v1/notifications/read', ids ? { ids } : {}),
  prefs: () => g<NotificationPrefs>('/v1/notifications/preferences'),
  savePrefs: (body: { channels?: Record<string, string>; digest?: boolean }) => send<NotificationPrefs>('PUT', '/v1/notifications/preferences', body),
  unsubscribe: (token: string) => send<{ ok: boolean }>('POST', '/v1/notifications/unsubscribe', { token }),
}

export const me = {
  needs: () => g<Needs>('/v1/me/needs'),
  finishTask: (table: string, id: string) => send<unknown>('POST', `/v1/me/tasks/${table}/${id}/done`),
  guide: () => g<Guide | null>('/v1/me/guide'),
  setGuide: (dismissed: boolean) => send<{ dismissed: boolean }>('PUT', '/v1/me/guide', { dismissed }),
}

export const sample = {
  status: () => g<{ available: boolean; loaded: boolean; count: number }>('/v1/workspace/sample'),
  load: () => send<{ loaded: boolean; count: number }>('POST', '/v1/workspace/sample'),
  remove: () => send<{ loaded: boolean; removed: number }>('DELETE', '/v1/workspace/sample'),
}

export const automations = {
  runs: (q: { automation?: string; status?: string } = {}) => g<AutomationRun[]>(`/v1/automations/runs${qs(q)}`),
  retry: (id: string) => send<{ status: string }>('POST', `/v1/automations/runs/${id}/retry`),
  preview: (body: unknown) => send<{ count: number; examples: string[]; complete: boolean }>('POST', '/v1/automations/preview', body),
}

export const studio = {
  tables: () => cast<StudioTable[]>(api.GET('/v1/studio/tables')),
  createTable: (body: { label: string; plural_label?: string; title_label?: string; description?: string }) =>
    send<StudioTable>('POST', '/v1/studio/tables', body),
  addField: (table: string, body: Partial<FieldDef> & { label: string; type: string }) =>
    send<FieldDef>('POST', `/v1/studio/tables/${table}/fields`, body),
  updateField: (table: string, field: string, body: Partial<FieldDef>) =>
    send<FieldDef>('PATCH', `/v1/studio/tables/${table}/fields/${field}`, body),
  removeField: (table: string, field: string) => send<void>('DELETE', `/v1/studio/tables/${table}/fields/${field}`),
  rules: () => g<{ id: string; checks: { id: string; severity: string; message: string; editable?: boolean; edited?: boolean }[] }[]>('/v1/studio/rules'),
  saveStages: (table: string, body: { labels: Record<string, string>; add?: { key: string; after: string } }) => send<unknown>('PUT', `/v1/studio/tables/${table}/stages`, body),
  setSeverity: (rule: string, check: string, severity: string) => send<unknown>('PUT', `/v1/studio/rules/${rule}/checks/${check}`, { severity }),
  relationships: () => g<Link[]>('/v1/studio/relationships'),
  automations: () => g<AutomationDraft[]>('/v1/studio/automations'),
  addAutomation: (body: unknown) => send<AutomationDraft>('POST', '/v1/studio/automations', body),
  saveAutomation: (key: string, body: unknown) => send<AutomationDraft>('PUT', `/v1/studio/automations/${key}`, body),
  removeAutomation: (key: string) => send<void>('DELETE', `/v1/studio/automations/${key}`),
  measures: () => g<MeasureDraft[]>('/v1/studio/measures'),
  addMeasure: (body: unknown) => send<MeasureDraft>('POST', '/v1/studio/measures', body),
  saveMeasure: (key: string, body: unknown) => send<MeasureDraft>('PUT', `/v1/studio/measures/${key}`, body),
  removeMeasure: (key: string) => send<void>('DELETE', `/v1/studio/measures/${key}`),
  linkHealth: () => g<LinkIssue[]>('/v1/studio/relationships/health'),
  layout: () => g<{ positions: Record<string, { x: number; y: number }> }>('/v1/studio/layout'),
  saveLayout: (positions: Record<string, { x: number; y: number }>) => send<unknown>('PUT', '/v1/studio/layout', { positions }),
  addRelationship: (body: { table: string; to: string; label?: string; required?: boolean }) => send<Link>('POST', '/v1/studio/relationships', body),
  addManyToMany: (body: { a: string; b: string; label?: string }) => send<{ table: string; label: string }>('POST', '/v1/studio/relationships/many-to-many', body),
  removeRelationship: (table: string, field: string) => send<void>('DELETE', `/v1/studio/relationships/${table}/${field}`),
  screens: () => g<DraftScreen[]>('/v1/studio/screens'),
  saveScreen: (key: string, body: Omit<DraftScreen, 'key' | 'version' | 'source'>) => send<DraftScreen>('PUT', `/v1/studio/screens/${key}`, body),
  navigation: () => g<DraftNav[]>('/v1/studio/navigation'),
  saveNavigation: (items: Omit<DraftNav, 'version'>[]) => send<DraftNav[]>('PUT', '/v1/studio/navigation', { items }),
  status: () => g<{ live_version: number | null; draft_changed: boolean; changes: ManifestDiff }>('/v1/studio/status'),
  compare: (from: string | number, to: string | number = 'draft') => g<ManifestDiff>(`/v1/apps/current/compare?from=${from}&to=${to}`),
  approvals: () => g<Approval[]>('/v1/apps/current/approvals'),
  runFixtures: (env: 'test' | 'live') => send<unknown>('POST', `/v1/apps/current/fixtures/run?env=${env}`),
  decide: (id: string, approve: boolean) => send<{ status: string; version: number }>('POST', `/v1/apps/current/approvals/${id}`, { approve }),
  releases: () => cast<ReleaseRow[]>(api.GET('/v1/apps/current/releases')),
  publishTest: () => cast<{ version: number }>(api.POST('/v1/apps/current/releases')),
  promote: (version: number) =>
    send<{ version: number; status: 'live' | 'pending_approval' }>('POST', `/v1/apps/current/releases/${version}/promote`),
  rollback: () => cast<{ version: number }>(api.POST('/v1/apps/current/rollback')),
}

export interface DraftScreen { key: string; title: string; pattern: string; table: string; config: Record<string, unknown>; roles: string[]; version: number; source?: string }
export interface DraftNav { key: string; label: string; screen: string; icon: string; section: string; order: number; roles: string[]; version: number; source?: string }
export interface Approval { approval_id: string; version: number; status: 'pending' | 'approved' | 'rejected'; requested_by: string; requested_at: string; decided_at: string | null }
export interface DiffItem { key: string; change: 'added' | 'removed' | 'changed'; attributes?: string[]; fields?: { field: string; change: string; label: string; attributes?: Record<string, { from: unknown; to: unknown }> }[] }
export interface ManifestDiff { changed: boolean; tables: DiffItem[]; screens: DiffItem[]; navs: DiffItem[]; rules: DiffItem[]; measures: DiffItem[]; automations: DiffItem[] }

export interface ListQuery {
  sort?: string
  direction?: string
  cursor?: string | null
  limit?: number
  q?: string
  filters?: Record<string, string>
  ranges?: Record<string, string>
  has?: Record<string, string>
  owner?: string
}
export interface Facet { label: string; kind: 'values' | 'range'; values: { value: string; label: string; count: number }[] }
export interface ScreenDef { key: string; title: string; pattern: string; table: string; config: Record<string, unknown>; roles: string[] }
export interface SavedSearch { id: string; table: string; name: string; query: { q?: string; filters?: Record<string, string>; ranges?: Record<string, string>; screen?: string | null } }
export interface MatchPart { label: string; weight: number; fraction: number; points: number; why: string }
export interface MatchResult {
  screen: string
  source: { table: string; id: string; label: unknown }
  weights: Record<string, number>
  defaults: Record<string, number>
  considered: number
  items: { id: string; score: number; parts: Record<string, MatchPart>; data: Record<string, unknown> }[]
}

const qs = (o: Record<string, string | number | undefined | null>) => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v))
  const t = p.toString()
  return t ? `?${t}` : ''
}

export const search = {
  bar: (q: string) =>
    g<{ q: string; screens: { kind: 'screen'; screen: string; label: string }[]; records: { kind: 'record'; table: string; table_label: string; id: string; label: string | null }[] }>(
      `/v1/search${qs({ q })}`,
    ),
  saved: () => g<SavedSearch[]>('/v1/search/saved'),
  save: (body: { table: string; screen?: string; name: string; query: SavedSearch['query'] }) => send<SavedSearch>('POST', '/v1/search/saved', body),
  remove: (id: string) => send<void>('DELETE', `/v1/search/saved/${id}`),
}

export const matching = {
  get: (screen: string, id: string, weights?: Record<string, number>) =>
    g<MatchResult>(`/v1/matching/${screen}/${id}${qs(Object.fromEntries(Object.entries(weights ?? {}).map(([k, v]) => [`w.${k}`, v])))}`),
  saveWeights: (screen: string, weights: Record<string, number>) => send<Record<string, number>>('PUT', `/v1/matching/${screen}/weights`, { weights }),
}

export const app = {
  facets: (table: string, query: ListQuery & { fields?: string[] }) => {
    const { filters, ranges, has, q, owner, fields } = query
    return g<{ total: number; facets: Record<string, Facet> }>(
      `/v1/records/${table}/facets${qs({
        q,
        owner,
        fields: fields?.join(','),
        ...Object.fromEntries(Object.entries(filters ?? {}).map(([k, v]) => [`f.${k}`, v])),
        ...Object.fromEntries(Object.entries(ranges ?? {}).map(([k, v]) => [`r.${k}`, v])),
        ...Object.fromEntries(Object.entries(has ?? {}).map(([k, v]) => [`has.${k}`, v])),
      })}`,
    )
  },
  screens: (query: { table?: string; pattern?: string; source_table?: string }) => g<ScreenDef[]>(`/v1/app/screens${qs(query)}`),
  table: (table: string) => cast<{ release_version: number; table: TableDef }>(api.GET('/v1/app/tables/{table}', { params: { path: { table } } })),
  tables: () => cast<{ release_version: number; tables: { key: string; label: string; plural_label: string }[] }>(api.GET('/v1/app/tables')),
  relations: (table: string) =>
    g<{ table: string; label: string; field: string; title_field: string; columns: string[] }[]>(`/v1/app/tables/${table}/relations`),
  related: (table: string, field: string, id: string) =>
    cast<RecordPage>(api.GET('/v1/records/{table}', { params: { path: { table }, query: { limit: 100, ['f.' + field]: id } as never } })),
  navigation: () =>
    cast<{ items: { key: string; label: string; icon: string; section: string; screen: string; pattern: string; table: string }[] }>(
      api.GET('/v1/app/navigation' as never),
    ),
  screen: (key: string) =>
    cast<{ screen: { key: string; title: string; pattern: string; table: string; config: Record<string, unknown> } }>(
      api.GET('/v1/app/screens/{screen}' as never, { params: { path: { screen: key } } } as never),
    ),
  list: (table: string, query: ListQuery) => {
    const { filters, ranges, has, cursor, q, ...rest } = query
    const extra = {
      ...Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v).map(([k, v]) => [`f.${k}`, v])),
      ...Object.fromEntries(Object.entries(ranges ?? {}).filter(([, v]) => v).map(([k, v]) => [`r.${k}`, v])),
      ...Object.fromEntries(Object.entries(has ?? {}).filter(([, v]) => v).map(([k, v]) => [`has.${k}`, v])),
    }
    return cast<RecordPage>(
      api.GET('/v1/records/{table}', {
        params: { path: { table }, query: { ...rest, ...extra, cursor: cursor ?? undefined, q: q || undefined } as never },
      }),
    )
  },
  get: (table: string, id: string) => cast<RecordRow>(api.GET('/v1/records/{table}/{record_id}', { params: { path: { table, record_id: id } } })),
  history: (table: string, id: string) =>
    cast<HistoryEntry[]>(api.GET('/v1/records/{table}/{record_id}/history', { params: { path: { table, record_id: id } } })),
  create: (table: string, data: Json, idempotencyKey: string) =>
    cast<RecordRow>(
      api.POST('/v1/records/{table}', {
        params: { path: { table }, header: { 'idempotency-key': idempotencyKey } },
        body: { data },
      }),
    ),
  update: (table: string, id: string, data: Json, version: number, idempotencyKey: string) =>
    cast<RecordRow>(
      api.PATCH('/v1/records/{table}/{record_id}' as never, {
        params: { path: { table, record_id: id }, header: { 'idempotency-key': idempotencyKey } },
        body: { data, version },
      } as never),
    ),
  options: (table: string) =>
    cast<RecordPage>(api.GET('/v1/records/{table}', { params: { path: { table }, query: { limit: 200, sort: 'updated_at', direction: 'desc' } } })),
  check: (table: string, data: Json) =>
    cast<{ outcomes: RuleOutcome[] }>(api.POST('/v1/records/{table}/check', { params: { path: { table } }, body: { data } })),
  measures: (range?: RangeQuery, home = false) => g<Measure[]>(`/v1/measures${qs({ ...range, home: home ? 'true' : undefined })}`),
  measure: (key: string, range?: RangeQuery) => g<Measure>(`/v1/measures/${key}${qs({ ...range })}`),
  measureRecords: (key: string, range?: RangeQuery, drill?: { group?: string; bucket?: string }) =>
    g<MeasureRecords>(`/v1/measures/${key}/records${qs({ ...range, ...drill })}`),
  previewMeasure: (body: unknown, range?: string) =>
    send<{ ok: boolean; problems: string[]; note?: string; card?: Measure }>('POST', `/v1/measures/preview${qs({ range })}`, body),
  rebuildMeasures: () => send<Record<string, number>>('POST', '/v1/measures/rebuild'),
  activity: () => cast<ActivityRow[]>(api.GET('/v1/activity')),
}

export interface WorkspaceLimits { max_people: number | null; max_records: number | null; max_storage_mb: number | null; ai_monthly_tokens: number | null }
export interface WorkspaceRow {
  id: string; name: string; pack: string | null; status: 'provisioning' | 'active' | 'suspended' | 'scheduled_deletion'
  reason: string | null; delete_after: string | null; created_at: string; owner_email: string | null
  people: number; records: number; storage_mb: number; last_activity: string | null
  limits: WorkspaceLimits; ai_tokens_this_month: number
}

export const ops = {
  workspaces: () => g<WorkspaceRow[]>('/v1/ops/workspaces'),
  createWorkspace: (body: { name: string; owner_email: string; pack_id?: string | null }) =>
    send<{ id: string; invite_link?: string }>('POST', '/v1/ops/workspaces', body),
  suspend: (id: string, reason: string) => send<unknown>('POST', `/v1/ops/workspaces/${id}/suspend`, { reason }),
  resume: (id: string) => send<unknown>('POST', `/v1/ops/workspaces/${id}/resume`),
  scheduleDelete: (id: string, body: { confirm_name: string; reason: string; grace_days: number }) =>
    send<unknown>('POST', `/v1/ops/workspaces/${id}/delete`, body),
  cancelDelete: (id: string) => send<unknown>('POST', `/v1/ops/workspaces/${id}/cancel-deletion`),
  exportWorkspace: (id: string, reason: string) =>
    send<{ download_link?: string; sent_to: string }>('POST', `/v1/ops/workspaces/${id}/export`, { reason }),
  setLimits: (id: string, body: Partial<WorkspaceLimits>) => send<unknown>('PUT', `/v1/ops/workspaces/${id}/limits`, body),
  signIn: (body: { email: string; password: string }) => cast<{ token: string }>(api.POST('/v1/ops/auth/sign-in', { body })),
  verify: (code: string, token: string) =>
    cast<void>(api.POST('/v1/ops/auth/mfa/verify', { body: { code }, headers: { Authorization: `Bearer ${token}` }, parseAs: 'text' })),
  tenants: () => cast<TenantRow[]>(api.GET('/v1/ops/tenants')),
  packs: () => g<{ id: string; title: string; version: string; compatible_with: string; fixtures: number; published: { version: string }[]; is_published: boolean }[]>('/v1/ops/packs'),
  publish: (id: string) => send<{ pack_id: string; version: string; fixtures: { total: number; passed: number } }>('POST', `/v1/ops/packs/${id}/publish`),
}

export interface StoredFile { id: string; kind: string; name: string; content_type: string; size_bytes: number; sha256: string; scan_status: 'pending' | 'clean' | 'infected' | 'error'; created_at: string }

export const files = {
  upload: (kind: 'logo' | 'cv' | 'import', file: File) => {
    const body = new FormData()
    body.append('kind', kind)
    body.append('file', file)
    return cast<StoredFile>(api.POST('/v1/files' as never, { body, bodySerializer: (b: FormData) => b } as never))
  },
  describe: (id: string) => g<StoredFile>(`/v1/files/${id}`),
}

export interface ParseState {
  file_id: string
  parser: string
  status: 'queued' | 'parsed' | 'failed'
  attempts: number
  error: string | null
  fields: Record<string, { value: unknown; confidence: number }>
  review: string[]
  has_text: boolean
  text_preview: string
  confirmed_record_id: string | null
}

export const documents = {
  parse: (fileId: string) => send<ParseState>('POST', `/v1/documents/${fileId}/parse`),
  state: (fileId: string) => g<ParseState>(`/v1/documents/${fileId}/parse`),
  confirm: (fileId: string, body: { screen: string; data?: Record<string, unknown>; existing_id?: string }) =>
    send<{ record: { table: string; id: string }; document: { table: string; id: string }; warnings: unknown[] }>('POST', `/v1/documents/${fileId}/confirm`, body),
}

export interface ImportColumn { header: string; samples: string[]; blanks: number; distinct: number; detected: string }
export interface ImportSuggestion { header: string; field: string | null; confidence: number; mark: 'high' | 'medium' | 'low' | 'none' }
export interface ImportDuplicate { row: number; label: unknown; severity: 'block' | 'warn'; default: 'skip' | 'create'; outcomes: { check: string; message: string; link: { table: string; id: string | null; row?: number; label: unknown } | null }[] }
export interface ImportJob {
  id: string
  table: string
  file_id: string
  state: 'uploaded' | 'mapped' | 'validated' | 'loading' | 'done' | 'failed' | 'undone'
  mapping: Record<string, string | null>
  resolutions: Record<string, { action: string; reason: string | null }>
  profile: { header: string[]; rows: number; columns: ImportColumn[]; suggestions: ImportSuggestion[]; reused_mapping: boolean }
  report: { rows?: number; valid?: number; invalid?: number; by_reason?: Record<string, number>; duplicates_total?: number; duplicates_blocking?: number; duplicates?: ImportDuplicate[]; failure?: string }
  counts: { read: number; loaded: number; updated: number; skipped: number; failed: number }
  finished_at: string | null
  can_undo: boolean
}
export interface ImportRow { id: string; table: string; state: ImportJob['state']; counts: ImportJob['counts']; created_at: string; file_name: string; by: string; can_undo: boolean }

export const imports = {
  create: (file_id: string, table: string) => send<ImportJob>('POST', '/v1/imports', { file_id, table }),
  get: (id: string) => g<ImportJob>(`/v1/imports/${id}`),
  history: () => g<ImportRow[]>('/v1/imports'),
  mapping: (id: string, mapping: Record<string, string | null>) => send<ImportJob>('PUT', `/v1/imports/${id}/mapping`, { mapping }),
  newField: (id: string, body: { header: string; label: string; type: string; options?: string[] }) =>
    send<{ field: { key: string }; live: boolean; job: ImportJob }>('POST', `/v1/imports/${id}/fields`, body),
  validate: (id: string) => send<ImportJob>('POST', `/v1/imports/${id}/validate`),
  resolve: (id: string, rows: Record<string, { action: string; reason?: string }>) => send<ImportJob>('PUT', `/v1/imports/${id}/resolutions`, { rows }),
  start: (id: string) => send<ImportJob>('POST', `/v1/imports/${id}/start`),
  undo: (id: string) => send<ImportJob>('POST', `/v1/imports/${id}/undo`),
  errorFile: (id: string) => unwrap<Blob>(api.GET(`/v1/imports/${id}/errors.csv` as never, { parseAs: 'blob' } as never) as never),
}

export interface OverrideInput { checks: string[]; reason: string }

export const flow = {
  board: (table: string, filters: Record<string, string>, q?: string) =>
    g<Board>(`/v1/workflow/${table}/board${qs({ q, ...Object.fromEntries(Object.entries(filters).map(([k, v]) => [`f.${k}`, v])) })}`),
  stages: (table: string, id: string) =>
    g<{ from: string | null; to: string; at: string; actor_name: string | null }[]>(`/v1/workflow/${table}/${id}/stages`),
  move: (table: string, id: string, version: number, data: Json, override?: OverrideInput) =>
    send<RecordRow>('PATCH', `/v1/records/${table}/${id}`, { version, data, override }),
}

export interface ApprovalRequestInput {
  table: string
  action: 'create' | 'update'
  data: Json
  record_id?: string
  version?: number
  note?: string
}

export const approvals = {
  list: (status: string | null, mine = false) => g<{ items: HeldChange[]; pending: number }>(`/v1/approvals${qs({ status: status ?? '', mine: mine ? 'true' : undefined })}`),
  request: (body: ApprovalRequestInput) => send<HeldChange>('POST', '/v1/approvals', body),
  decide: (id: string, decision: 'approve' | 'reject', note: string) => send<HeldChange>('POST', `/v1/approvals/${id}/decision`, { decision, note }),
  cancel: (id: string) => send<HeldChange>('POST', `/v1/approvals/${id}/cancel`),
}

export interface CompareResult {
  a: RecordRow
  b: RecordRow
  fields: { key: string; label: string; a: unknown; b: unknown; same: boolean }[]
  links: { table: string; label: string; a: number; b: number }[]
}

export const duplicates = {
  pairs: (table: string) => g<{ items: DuplicatePair[]; table: string }>(`/v1/duplicates/${table}`),
  compare: (table: string, a: string, b: string) => g<CompareResult>(`/v1/duplicates/${table}/compare${qs({ a, b })}`),
  dismiss: (table: string, a: string, b: string) => send<void>('POST', `/v1/duplicates/${table}/dismiss`, { a, b }),
  merge: (table: string, keep: string, drop: string, take: Record<string, string>) =>
    send<{ id: string; relinked: number }>('POST', `/v1/duplicates/${table}/merge`, { keep, drop, take }),
  merges: (table: string) => g<MergeRow[]>(`/v1/duplicates/${table}/merges`),
  undo: (table: string, id: string) => send<{ links: number }>('POST', `/v1/duplicates/${table}/merges/${id}/undo`),
}

export interface AiSettings {
  enabled: boolean
  available: boolean
  provider: string | null
  tables: string[]
  monthly_token_cap?: number
  used_tokens?: number
  all_tables?: string[]
  recent?: { at: string; feature: string; prompt_version: string; subject: string | null; provider: string | null; model: string | null; tokens: number; outcome: string; detail: string | null; by: string | null }[]
}
export interface AiText { text: string; cached: boolean; prompt_version: string }
export interface AiSuggestions { suggestions: Record<string, { value: unknown; quote: string }>; current: Record<string, unknown>; review: string[]; cached: boolean; note?: string }

export interface SetupStep { op: string; args: Record<string, unknown>; why: string; ok: boolean; error?: string }
export interface SetupPlan { id: string; request: string; reply: string; steps: SetupStep[]; status: 'proposed' | 'applied' | 'undone' | 'discarded'; created_at: string; applied_at: string | null; undone_at: string | null }
export interface SetupState {
  messages: { role: 'user' | 'assistant'; content: string; plan_id: string | null; at: string }[]
  open_plan: SetupPlan | null
  undoable: SetupPlan | null
  enabled: boolean
  available: boolean
  can_apply: boolean
}

export const ai = {
  setupState: () => g<SetupState>('/v1/ai/setup'),
  setupSay: (message: string) => send<{ reply: string; plan: SetupPlan | null }>('POST', '/v1/ai/setup/messages', { message }),
  setupApply: (id: string, steps: number[]) => send<SetupPlan>('POST', `/v1/ai/setup/plans/${id}/apply`, { steps }),
  setupUndo: (id: string) => send<SetupPlan>('POST', `/v1/ai/setup/plans/${id}/undo`),
  setupDiscard: (id: string) => send<void>('POST', `/v1/ai/setup/plans/${id}/discard`),
  settings: () => g<AiSettings>('/v1/ai/settings'),
  saveSettings: (body: { enabled?: boolean; tables?: string[]; monthly_token_cap?: number }) => send<AiSettings>('PUT', '/v1/ai/settings', body),
  extract: (screen: string, file_id: string) => send<AiSuggestions>('POST', '/v1/ai/extract', { screen, file_id }),
  summary: (table: string, id: string) => send<AiText & { used: string[] }>('POST', '/v1/ai/summary', { table, id }),
  explainMatch: (screen: string, source_id: string, target_id: string) => send<AiText & { score: number }>('POST', '/v1/ai/explain-match', { screen, source_id, target_id }),
  ask: (table: string, question: string) => send<{ filters: Record<string, string>; q: string; cached: boolean }>('POST', '/v1/ai/ask', { table, question }),
  draft: (table: string, id: string, intent: string) => send<{ subject: string; body: string; cached: boolean }>('POST', '/v1/ai/draft', { table, id, intent }),
  explainNumber: (measure: string, range?: string) => send<AiText & { figures: { value: number | null } }>('POST', '/v1/ai/explain-number', { measure, range }),
}
