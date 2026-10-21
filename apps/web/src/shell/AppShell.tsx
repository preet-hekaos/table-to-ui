import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { BarChart3, CheckCheck, ClipboardList, Home, LayoutGrid, LogOut, Menu, Settings2, Bookmark, Upload, UserPlus, Users, X } from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { app, approvals, auth } from '@/api/endpoints'
import { preview, tokens } from '@/api/session'
import { can, useMe } from '@/features/auth/useMe'
import { Button, LoadingState } from '@/design-system'
import { useBrand } from '@/features/workspace/useBrand'
import { CommandBar } from '@/features/search/CommandBar'
import { NotificationBell } from '@/features/notifications/Bell'
import { search } from '@/api/endpoints'

function NavLink({ to, params, search: q, icon, children, onNavigate }: { to: string; params?: Record<string, string>; search?: Record<string, string>; icon: ReactNode; children: ReactNode; onNavigate: () => void }) {
  return (
    <Link
      to={to}
      params={params}
      search={q as never}
      onClick={onNavigate}
      className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium text-nav-text hover:text-white"
      activeProps={{ className: 'bg-nav-active !text-white font-semibold', 'aria-current': 'page' }}
      activeOptions={{ exact: to === '/' }}
    >
      {icon}
      {children}
    </Link>
  )
}

/** The branded app frame: agency logo and name, navigation for the user's role, search, notifications, user menu. */
export function AppShell() {
  const me = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { brand, logo, style } = useBrand()
  const saved = useQuery({ queryKey: ['saved-searches'], queryFn: search.saved, enabled: !!me.data, retry: false })
  const pending = useQuery({ queryKey: ['approvals', 'count'], queryFn: () => approvals.list('pending'), enabled: !!me.data, retry: false, refetchInterval: 60_000 })
  const menu = useQuery({
    queryKey: ['navigation'],
    queryFn: app.navigation,
    enabled: !!me.data,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  })

  if (me.isLoading) return <div className="p-6"><LoadingState label="Loading your workspace" /></div>
  if (!me.data) return null
  const perms = me.data.permissions
  const close = () => setOpen(false)

  async function signOut() {
    try {
      await auth.signOut()
    } finally {
      tokens.set(null)
      qc.clear()
      await navigate({ to: '/sign-in' })
    }
  }

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      <NavLink to="/" icon={<Home className="size-4" aria-hidden />} onNavigate={close}>Home</NavLink>
      {['main', 'more'].map((section) => {
        const items = menu.data?.items.filter((n) => (n.section || 'main') === section) ?? []
        if (!items.length) return null
        return (
          <div key={section} className="flex flex-col gap-0.5" role="group" aria-label={section === 'main' ? undefined : 'More'}>
            {section !== 'main' && <p className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-nav-text uppercase">More</p>}
            {items.map((n) => (
              <NavLink key={n.key} to="/s/$screen" params={{ screen: n.screen }} icon={<Users className="size-4" aria-hidden />} onNavigate={close}>
                {n.label}
              </NavLink>
            ))}
          </div>
        )
      })}
      {(saved.data?.length ?? 0) > 0 && (
        <div className="flex flex-col gap-0.5" role="group" aria-label="Saved searches">
          <p className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-nav-text uppercase">Saved searches</p>
          {saved.data!.map((x) => {
            const screen = x.query.screen ?? menu.data?.items.find((n) => n.table === x.table)?.screen
            return screen ? (
              <NavLink key={x.id} to="/s/$screen" params={{ screen }} search={{ saved: x.id }} icon={<Bookmark className="size-4" aria-hidden />} onNavigate={close}>
                {x.name}
              </NavLink>
            ) : null
          })}
        </div>
      )}
      {can(perms, 'measure.read') && (
        <NavLink to="/insights" icon={<BarChart3 className="size-4" aria-hidden />} onNavigate={close}>Insights</NavLink>
      )}
      <NavLink to="/approvals" icon={<CheckCheck className="size-4" aria-hidden />} onNavigate={close}>
        Approvals{pending.data?.pending ? <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] text-white" aria-label={`${pending.data.pending} waiting`}>{pending.data.pending}</span> : null}
      </NavLink>
      {can(perms, 'metadata.read') && (
        <NavLink to="/studio" icon={<LayoutGrid className="size-4" aria-hidden />} onNavigate={close}>Studio</NavLink>
      )}
      {can(perms, 'import.run') && (
        <NavLink to="/import" icon={<Upload className="size-4" aria-hidden />} onNavigate={close}>Import</NavLink>
      )}
      {can(perms, 'audit.read') && (
        <NavLink to="/activity" icon={<ClipboardList className="size-4" aria-hidden />} onNavigate={close}>Activity</NavLink>
      )}
      {can(perms, 'workspace.manage') && (
        <NavLink to="/settings" icon={<Settings2 className="size-4" aria-hidden />} onNavigate={close}>Settings</NavLink>
      )}
      {can(perms, 'invitation.send') && (
        <NavLink to="/team" icon={<UserPlus className="size-4" aria-hidden />} onNavigate={close}>Team</NavLink>
      )}
      <NavLink to="/security" icon={<Settings2 className="size-4" aria-hidden />} onNavigate={close}>Security</NavLink>
    </nav>
  )

  return (
    <div data-theme="agency" className="flex h-full" style={style as CSSProperties | undefined}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-2">Skip to content</a>
      <aside className={`${open ? 'fixed inset-0 z-40 flex' : 'hidden'} md:static md:flex`}>
        <div className="flex h-full w-56 flex-col gap-4 overflow-y-auto bg-nav p-3">
          <div className="flex items-center gap-2 px-1 text-sm font-bold text-white">
            {logo ? (
              <img src={logo} alt="" className="size-7 rounded-lg bg-white object-contain" data-testid="app-logo" />
            ) : (
              <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-xs" aria-hidden>{(brand?.app_name ?? me.data.tenant_name)?.[0] ?? 'T'}</span>
            )}
            <span className="truncate" data-testid="app-name">{brand?.app_name ?? me.data.tenant_name}</span>
          </div>
          {nav}
        </div>
        {open && <button aria-label="Close menu" className="flex-1 bg-ink/40 md:hidden" onClick={close} />}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
          <Button variant="ghost" size="sm" className="md:hidden" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </Button>
          <CommandBar />
          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <span className="hidden text-right text-xs leading-tight sm:block">
              <b className="block text-ink">{me.data.full_name}</b>
              <span className="text-muted capitalize">{me.data.role}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => void signOut()}><LogOut className="size-4" aria-hidden /> Sign out</Button>
          </div>
        </header>
        {preview.role && (
          <div role="status" className="bg-accent-soft px-4 py-2 text-sm text-accent-ink" data-testid="preview-banner">
            Previewing as <b className="capitalize">{preview.role.replace('_', ' ')}</b> on {preview.env === 'test' ? 'Test' : 'Live'}. Read-only.
          </div>
        )}
        {!me.data.mfa_enabled && !preview.role && (
          <div role="status" className="flex flex-wrap items-center gap-2 bg-warn-soft px-4 py-2 text-sm text-warn-ink">
            Protect your account with two-step sign-in.
            <Link to="/security" className="font-semibold underline">Set it up</Link>
          </div>
        )}
        <main id="main" className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
