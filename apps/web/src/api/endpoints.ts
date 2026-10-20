/** One function per endpoint. Request shapes are checked against the generated OpenAPI types;
 *  response shapes come from ./types until the API publishes response models for them. */
import { api, unwrap } from './client'
import type {
  ActivityRow,
  HistoryEntry,
  Measure,
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

export interface RoleRow { key: string; name: string; description: string; members: number; grants: string[]; scopes: Record<string, string>; field_deny: string[] }
export interface PersonRow { id: string; email: string; full_name: string; active: boolean; role: string; teams: string[] }
export interface TeamRow { id: string; name: string; members: string[] }
export interface WorkspaceSettings { brand: { app_name: string; accent: string; logo_file_id: string | null }; regional: Record<string, string> }

export const admin = {
  home: () => g<{ workspace: string; pack_id: string | null; release_version: number | null; checklist: { key: string; label: string; done: boolean; to: string }[]; pack_updates: unknown[] }>('/v1/workspace/home'),
  people: () => g<PersonRow[]>('/v1/workspace/people'),
  setActive: (id: string, active: boolean) => send<void>('POST', `/v1/workspace/people/${id}/${active ? 'activate' : 'deactivate'}`),
  setRole: (id: string, role: string) => send<void>('PUT', `/v1/workspace/people/${id}/role`, { role }),
  teams: () => g<TeamRow[]>('/v1/workspace/teams'),
  createTeam: (name: string) => send<TeamRow>('POST', '/v1/workspace/teams', { name }),
  setMembers: (id: string, user_ids: string[]) => send<void>('PUT', `/v1/workspace/teams/${id}/members`, { user_ids }),
  roles: () => g<RoleRow[]>('/v1/workspace/roles'),
  saveRole: (r: Omit<RoleRow, 'members'>, isNew: boolean) =>
    send<void>(isNew ? 'POST' : 'PUT', isNew ? '/v1/workspace/roles' : `/v1/workspace/roles/${r.key}`, r),
  settings: () => g<WorkspaceSettings>('/v1/workspace/settings'),
  saveBrand: (b: { app_name: string; accent: string }) => send<WorkspaceSettings['brand']>('PUT', '/v1/workspace/settings/brand', b),
  saveRegional: (r: Record<string, string>) => send<Record<string, string>>('PUT', '/v1/workspace/settings/regional', r),
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
export interface ManifestDiff { changed: boolean; tables: DiffItem[]; screens: DiffItem[]; navs: DiffItem[]; rules: DiffItem[]; measures: DiffItem[] }

export const app = {
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
  list: (
    table: string,
    query: { sort?: string; direction?: string; cursor?: string | null; limit?: number; q?: string; filters?: Record<string, string> },
  ) => {
    const { filters, cursor, q, ...rest } = query
    const extra = Object.fromEntries(Object.entries(filters ?? {}).filter(([, v]) => v).map(([k, v]) => [`f.${k}`, v]))
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
  measures: () => cast<Measure[]>(api.GET('/v1/measures')),
  activity: () => cast<ActivityRow[]>(api.GET('/v1/activity')),
}

export const ops = {
  signIn: (body: { email: string; password: string }) => cast<{ token: string }>(api.POST('/v1/ops/auth/sign-in', { body })),
  verify: (code: string, token: string) =>
    cast<void>(api.POST('/v1/ops/auth/mfa/verify', { body: { code }, headers: { Authorization: `Bearer ${token}` }, parseAs: 'text' })),
  tenants: () => cast<TenantRow[]>(api.GET('/v1/ops/tenants')),
}
