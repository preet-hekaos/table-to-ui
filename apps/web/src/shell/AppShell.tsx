import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { Bell, ClipboardList, Home, LayoutGrid, LogOut, Menu, Search, Settings2, UserPlus, Users, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { app, auth } from '@/api/endpoints'
import { tokens } from '@/api/session'
import { can, useMe } from '@/features/auth/useMe'
import { Button, LoadingState } from '@/design-system'

function NavLink({ to, params, icon, children, onNavigate }: { to: string; params?: Record<string, string>; icon: ReactNode; children: ReactNode; onNavigate: () => void }) {
  return (
    <Link
      to={to}
      params={params}
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
      {menu.data?.items.map((n) => (
        <NavLink key={n.key} to="/s/$screen" params={{ screen: n.screen }} icon={<Users className="size-4" aria-hidden />} onNavigate={close}>
          {n.label}
        </NavLink>
      ))}
      {can(perms, 'metadata.read') && (
        <NavLink to="/studio" icon={<LayoutGrid className="size-4" aria-hidden />} onNavigate={close}>Studio</NavLink>
      )}
      {can(perms, 'audit.read') && (
        <NavLink to="/activity" icon={<ClipboardList className="size-4" aria-hidden />} onNavigate={close}>Activity</NavLink>
      )}
      {can(perms, 'invitation.send') && (
        <NavLink to="/team" icon={<UserPlus className="size-4" aria-hidden />} onNavigate={close}>Team</NavLink>
      )}
      <NavLink to="/security" icon={<Settings2 className="size-4" aria-hidden />} onNavigate={close}>Security</NavLink>
    </nav>
  )

  return (
    <div data-theme="agency" className="flex h-full">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-2">Skip to content</a>
      <aside className={`${open ? 'fixed inset-0 z-40 flex' : 'hidden'} md:static md:flex`}>
        <div className="flex w-56 flex-col gap-4 bg-nav p-3">
          <div className="flex items-center gap-2 px-1 text-sm font-bold text-white">
            <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-xs" aria-hidden>{me.data.tenant_name?.[0] ?? 'T'}</span>
            <span className="truncate" data-testid="app-name">{me.data.tenant_name}</span>
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
          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search className="absolute top-2.5 left-2.5 size-4 text-muted" aria-hidden />
            <input aria-label="Search" placeholder="Search candidates, jobs, clients (coming soon)" disabled className="h-9 w-full rounded-md border border-line bg-canvas pr-3 pl-8 text-sm" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" size="sm" aria-label="Notifications" disabled><Bell className="size-4" aria-hidden /></Button>
            <span className="hidden text-right text-xs leading-tight sm:block">
              <b className="block text-ink">{me.data.full_name}</b>
              <span className="text-muted capitalize">{me.data.role}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => void signOut()}><LogOut className="size-4" aria-hidden /> Sign out</Button>
          </div>
        </header>
        {!me.data.mfa_enabled && (
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
