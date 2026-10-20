import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router'
import { ApiError } from '@/api/client'
import { tokens } from '@/api/session'
import { AcceptInvitation } from '@/features/auth/AcceptInvitation'
import { MfaVerify } from '@/features/auth/Mfa'
import { MfaSetup } from '@/features/auth/MfaSetup'
import { SignIn } from '@/features/auth/SignIn'
import { SignUp } from '@/features/auth/SignUp'
import { meKey } from '@/features/auth/useMe'
import { auth, workspace } from '@/api/endpoints'
import { RecordDetail } from '@/features/records/RecordDetail'
import { RecordEdit } from '@/features/records/RecordEdit'
import { RecordNew } from '@/features/records/RecordNew'
import { ScreenView } from '@/features/screens/ScreenView'
import { RecordsList } from '@/features/records/RecordsList'
import { Home } from '@/features/home/Home'
import { Approvals } from '@/features/approvals/Approvals'
import { Onboarding, onboardingKey } from '@/features/onboarding/Onboarding'
import { OpsShell, OpsSignIn, PackCatalog, TenantDirectory } from '@/features/ops/Ops'
import { Activity } from '@/features/studio/Activity'
import { ImportWizard } from '@/features/imports/ImportWizard'
import { RankedList } from '@/patterns/RankedList'
import { PatternGallery } from '@/features/patterns/PatternGallery'
import { Settings } from '@/features/settings/Settings'
import { Studio, type StudioTab } from '@/features/studio/Studio'
import { Team } from '@/features/studio/Team'
import { NotFound } from '@/design-system'
import { AppShell } from '@/shell/AppShell'

interface Ctx {
  queryClient: QueryClient
}

const root = createRootRouteWithContext<Ctx>()({ component: Outlet, notFoundComponent: () => <div className="p-6"><NotFound /></div> })

const signUp = createRoute({ getParentRoute: () => root, path: '/signup', component: SignUp })
const signIn = createRoute({ getParentRoute: () => root, path: '/sign-in', component: SignIn })
const mfa = createRoute({ getParentRoute: () => root, path: '/mfa', component: MfaVerify })
const accept = createRoute({
  getParentRoute: () => root,
  path: '/accept-invitation',
  validateSearch: (s: Record<string, unknown>) => ({ token: typeof s.token === 'string' ? s.token : '' }),
  component: function AcceptRoute() {
    const { token } = accept.useSearch()
    return <AcceptInvitation token={token} />
  },
})

/** Everything inside the signed-in app requires a session and, when enabled, a verified second factor. */
const shell = createRoute({
  getParentRoute: () => root,
  id: 'app',
  beforeLoad: async ({ context, location }) => {
    if (!tokens.get()) throw redirect({ to: '/sign-in' })
    try {
      const me = await context.queryClient.ensureQueryData({ queryKey: meKey, queryFn: auth.me, staleTime: 60_000 })
      if (me.mfa_enabled && !me.mfa_verified) throw redirect({ to: '/mfa' })
      const ob = await context.queryClient.fetchQuery({ queryKey: onboardingKey, queryFn: workspace.onboarding, staleTime: 0 })
      const path = location.pathname
      if (ob.step !== 'done' && path !== '/onboarding' && path !== '/security') throw redirect({ to: '/onboarding' })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        tokens.set(null)
        throw redirect({ to: '/sign-in' })
      }
      throw e
    }
  },
  component: AppShell,
})
const onboarding = createRoute({ getParentRoute: () => shell, path: '/onboarding', component: Onboarding })
const home = createRoute({ getParentRoute: () => shell, path: '/', component: Home })
const screenRoute = createRoute({
  getParentRoute: () => shell,
  path: '/s/$screen',
  validateSearch: (s: Record<string, unknown>): { saved?: string; ref?: string; id?: string } => ({
    saved: typeof s.saved === 'string' ? s.saved : undefined,
    ref: typeof s.ref === 'string' ? s.ref : undefined,
    id: typeof s.id === 'string' ? s.id : undefined,
  }),
  component: function ScreenRoute() {
    const { saved, ref, id } = screenRoute.useSearch()
    return <ScreenView screenKey={screenRoute.useParams().screen} saved={saved} filter={ref && id ? { ref, id } : undefined} />
  },
})
const list = createRoute({
  getParentRoute: () => shell,
  path: '/records/$table',
  component: function ListRoute() {
    return <RecordsList tableKey={list.useParams().table} />
  },
})
const create = createRoute({
  getParentRoute: () => shell,
  path: '/records/$table/new',
  validateSearch: (s: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
  component: function NewRoute() {
    return <RecordNew tableKey={create.useParams().table} prefill={create.useSearch()} />
  },
})
const detail = createRoute({
  getParentRoute: () => shell,
  path: '/records/$table/$id',
  component: function DetailRoute() {
    const { table, id } = detail.useParams()
    return <RecordDetail tableKey={table} id={id} />
  },
})
const edit = createRoute({
  getParentRoute: () => shell,
  path: '/records/$table/$id/edit',
  component: function EditRoute() {
    const { table, id } = edit.useParams()
    return <RecordEdit tableKey={table} id={id} />
  },
})
const studio = createRoute({
  getParentRoute: () => shell,
  path: '/studio',
  validateSearch: (s: Record<string, unknown>): { tab?: StudioTab; table?: string } => ({
    tab: typeof s.tab === 'string' ? (s.tab as StudioTab) : undefined,
    table: typeof s.table === 'string' ? s.table : undefined,
  }),
  component: function StudioRoute() {
    const { tab, table } = studio.useSearch()
    return <Studio tab={tab} table={table} />
  },
})
const importRoute = createRoute({
  getParentRoute: () => shell,
  path: '/import',
  validateSearch: (s: Record<string, unknown>): { job?: string } => ({ job: typeof s.job === 'string' ? s.job : undefined }),
  component: function ImportRoute() {
    return <ImportWizard jobId={importRoute.useSearch().job} />
  },
})
const matchRoute = createRoute({
  getParentRoute: () => shell,
  path: '/match/$screen/$id',
  component: function MatchRoute() {
    const { screen, id } = matchRoute.useParams()
    return <RankedList screenKey={screen} sourceId={id} />
  },
})
const patterns = createRoute({ getParentRoute: () => shell, path: '/patterns', component: PatternGallery })
const approvalsRoute = createRoute({ getParentRoute: () => shell, path: '/approvals', component: Approvals })
const activity = createRoute({ getParentRoute: () => shell, path: '/activity', component: Activity })
const settings = createRoute({
  getParentRoute: () => shell,
  path: '/settings',
  validateSearch: (s: Record<string, unknown>): { tab?: string } => ({ tab: typeof s.tab === 'string' ? s.tab : undefined }),
  component: function SettingsRoute() {
    return <Settings tab={settings.useSearch().tab} />
  },
})
const security = createRoute({ getParentRoute: () => shell, path: '/security', component: MfaSetup })
const team = createRoute({ getParentRoute: () => shell, path: '/team', component: Team })

const opsSignIn = createRoute({ getParentRoute: () => root, path: '/ops/sign-in', component: OpsSignIn })
const opsShell = createRoute({ getParentRoute: () => root, id: 'ops', component: OpsShell })
const opsTenants = createRoute({ getParentRoute: () => opsShell, path: '/ops/tenants', component: TenantDirectory })
const opsPacks = createRoute({ getParentRoute: () => opsShell, path: '/ops/packs', component: PackCatalog })

const tree = root.addChildren([
  signUp,
  signIn,
  mfa,
  accept,
  shell.addChildren([onboarding, home, screenRoute, list, create, detail, edit, studio, importRoute, matchRoute, patterns, approvalsRoute, activity, security, team, settings]),
  opsSignIn,
  opsShell.addChildren([opsTenants, opsPacks]),
])

export const makeRouter = (queryClient: QueryClient) => createRouter({ routeTree: tree, context: { queryClient }, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof makeRouter>
  }
}
