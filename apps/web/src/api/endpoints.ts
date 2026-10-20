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

export const studio = {
  tables: () => cast<StudioTable[]>(api.GET('/v1/studio/tables')),
  releases: () => cast<ReleaseRow[]>(api.GET('/v1/apps/current/releases')),
  publishTest: () => cast<{ version: number }>(api.POST('/v1/apps/current/releases')),
  promote: (version: number) => cast<{ version: number }>(api.POST('/v1/apps/current/releases/{version}/promote', { params: { path: { version } } })),
  rollback: () => cast<{ version: number }>(api.POST('/v1/apps/current/rollback')),
}

export const app = {
  table: (table: string) => cast<{ release_version: number; table: TableDef }>(api.GET('/v1/app/tables/{table}', { params: { path: { table } } })),
  tables: () => cast<{ release_version: number; tables: { key: string; label: string; plural_label: string }[] }>(api.GET('/v1/app/tables')),
  list: (table: string, query: { sort?: string; direction?: string; cursor?: string | null; limit?: number }) =>
    cast<RecordPage>(
      api.GET('/v1/records/{table}', {
        params: { path: { table }, query: { ...query, cursor: query.cursor ?? undefined } },
      }),
    ),
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
