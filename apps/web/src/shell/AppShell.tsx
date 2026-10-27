import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { BarChart3, CheckCheck, ClipboardList, Home, LayoutGrid, LogOut, Maximize2, Menu, Minimize2, PanelLeftClose, PanelLeftOpen, Settings2, Bookmark, Upload, UserPlus, Users, X } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useDesktop, useSidebar } from './useSidebar'
import { ApiError } from '@/api/client'
import { app, approvals, auth } from '@/api/endpoints'
import { preview, tokens } from '@/api/session'
import { can, useMe } from '@/features/auth/useMe'
import { Button, LoadingState } from '@/design-system'
import { useBrand } from '@/features/workspace/useBrand'
import { CommandBar } from '@/features/search/CommandBar'
import { NotificationBell } from '@/features/notifications/Bell'
import { search } from '@/api/endpoints'

/** Two letters for a menu item in the rail, so items that share an icon still look different. */
export const monogram = (label: string) => {
  const w = label.trim().split(/\s+/)
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase()
}

interface Tip {
  label: string
  top: number
}

function NavLink({ to, params, search: q, icon, children, onNavigate, rail, label, onTip }: { to: string; params?: Record<string, string>; search?: Record<string, string>; icon: ReactNode; children: ReactNode; onNavigate: () => void; rail?: boolean; label: string; onTip: (t: Tip | null) => void }) {
  const show = (e: { currentTarget: HTMLElement }) => rail && onTip({ label, top: e.currentTarget.getBoundingClientRect().top + e.currentTarget.offsetHeight / 2 })
  return (
    <Link
      to={to}
      params={params}
      search={q as never}
      onClick={onNavigate}
      onMouseEnter={show}
      onFocus={show}
      onMouseLeave={() => onTip(null)}
      onBlur={() => onTip(null)}
      className={`flex items-center rounded-md py-2 text-[13px] font-medium text-nav-text hover:text-white ${rail ? 'justify-center px-0' : 'gap-2.5 px-2.5'}`}
      activeProps={{ className: 'bg-nav-active !text-white font-semibold', 'aria-current': 'page' }}
      activeOptions={{ exact: to === '/' }}
    >
      {icon}
      <span className={rail ? 'sr-only' : 'contents'}>{children}</span>
    </Link>
  )
}

/** The branded app frame: agency logo and name, navigation for the user's role, search, notifications, user menu. */
export function AppShell() {
  const me = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [tip, setTip] = useState<Tip | null>(null)
  const side = useSidebar()
  const desktop = useDesktop()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
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
  const rail = desktop && side.state === 'collapsed' && !open
  const hidden = desktop && side.state === 'hidden'

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
      <NavLink rail={rail} onTip={setTip} to="/" icon={<Home className="size-4" aria-hidden />} onNavigate={close} label="Home">Home</NavLink>
      {['main', 'more'].map((section) => {
        const items = menu.data?.items.filter((n) => (n.section || 'main') === section) ?? []
        if (!items.length) return null
        return (
          <div key={section} className="flex flex-col gap-0.5" role="group" aria-label={section === 'main' ? undefined : 'More'}>
            {section !== 'main' && <p className="px-2.5 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-nav-text uppercase">More</p>}
            {items.map((n) => (
              <NavLink rail={rail} onTip={setTip} key={n.key} to="/s/$screen" params={{ screen: n.screen }} icon={rail ? <span className="flex size-5 items-center justify-center text-[11px] font-bold" aria-hidden>{monogram(n.label)}</span> : <Users className="size-4" aria-hidden />} onNavigate={close} label={n.label}>
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
              <NavLink rail={rail} onTip={setTip} key={x.id} to="/s/$screen" params={{ screen }} search={{ saved: x.id }} icon={<Bookmark className="size-4" aria-hidden />} onNavigate={close} label={x.name}>
                {x.name}
              </NavLink>
            ) : null
          })}
        </div>
      )}
      {can(perms, 'measure.read') && (
        <NavLink rail={rail} onTip={setTip} to="/insights" icon={<BarChart3 className="size-4" aria-hidden />} onNavigate={close} label="Insights">Insights</NavLink>
      )}
      <NavLink rail={rail} onTip={setTip} to="/approvals" icon={<CheckCheck className="size-4" aria-hidden />} onNavigate={close} label="Approvals">
        Approvals{pending.data?.pending ? <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] text-white" aria-label={`${pending.data.pending} waiting`}>{pending.data.pending}</span> : null}
      </NavLink>
      {can(perms, 'metadata.read') && (
        <NavLink rail={rail} onTip={setTip} to="/studio" icon={<LayoutGrid className="size-4" aria-hidden />} onNavigate={close} label="Studio">Studio</NavLink>
      )}
      {can(perms, 'import.run') && (
        <NavLink rail={rail} onTip={setTip} to="/import" icon={<Upload className="size-4" aria-hidden />} onNavigate={close} label="Import">Import</NavLink>
      )}
      {can(perms, 'audit.read') && (
        <NavLink rail={rail} onTip={setTip} to="/activity" icon={<ClipboardList className="size-4" aria-hidden />} onNavigate={close} label="Activity">Activity</NavLink>
      )}
      {can(perms, 'workspace.manage') && (
        <NavLink rail={rail} onTip={setTip} to="/settings" icon={<Settings2 className="size-4" aria-hidden />} onNavigate={close} label="Settings">Settings</NavLink>
      )}
      {can(perms, 'invitation.send') && (
        <NavLink rail={rail} onTip={setTip} to="/team" icon={<UserPlus className="size-4" aria-hidden />} onNavigate={close} label="Team">Team</NavLink>
      )}
      <NavLink rail={rail} onTip={setTip} to="/security" icon={<Settings2 className="size-4" aria-hidden />} onNavigate={close} label="Security">Security</NavLink>
    </nav>
  )

  return (
    <div data-theme="agency" className="flex h-full" style={style as CSSProperties | undefined}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-surface focus:p-2">Skip to content</a>
      <aside className={`${open ? 'fixed inset-0 z-40 flex' : hidden ? 'hidden' : 'hidden md:flex'} ${side.fullScreen ? '!hidden' : ''}`}>
        <div className={`flex h-full flex-col gap-4 overflow-y-auto bg-nav p-3 transition-[width] duration-150 motion-reduce:transition-none ${rail ? 'w-16 items-center' : 'w-56'}`} data-sidebar={rail ? 'collapsed' : 'expanded'}>
          <div className="flex items-center gap-2 px-1 text-sm font-bold text-white">
            {logo ? (
              <img src={logo} alt="" className="size-7 rounded-lg bg-white object-contain" data-testid="app-logo" />
            ) : (
              <span className="flex size-7 items-center justify-center rounded-lg bg-accent text-xs" aria-hidden>{(brand?.app_name ?? me.data.tenant_name)?.[0] ?? 'T'}</span>
            )}
            <span className={rail ? 'sr-only' : 'truncate'} data-testid="app-name">{brand?.app_name ?? me.data.tenant_name}</span>
          </div>
          {nav}
          {desktop && !open && (
            <div className={`mt-auto flex gap-1 border-t border-white/10 pt-2 ${rail ? 'flex-col' : ''}`}>
              <button
                type="button"
                className="flex size-9 items-center justify-center rounded-md text-nav-text hover:text-white"
                aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-expanded={!rail}
                title={rail ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
                onClick={() => side.choose(rail ? 'expanded' : 'collapsed')}
              >
                {rail ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
              </button>
              <button type="button" className="flex size-9 items-center justify-center rounded-md text-nav-text hover:text-white" aria-label="Hide sidebar" title="Hide sidebar" onClick={() => side.choose('hidden')}>
                <X className="size-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
        {open && <button aria-label="Close menu" className={`flex-1 bg-ink/40 ${hidden ? '' : 'md:hidden'}`} onClick={close} />}
      </aside>
      {tip && rail && (
        <div role="presentation" aria-hidden className="pointer-events-none fixed left-[4.25rem] z-50 -translate-y-1/2 rounded-md bg-ink px-2 py-1 text-xs font-semibold text-white shadow-lg" style={{ top: tip.top }}>
          {tip.label}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 ${side.fullScreen ? 'hidden' : 'flex'}`}>
          <Button variant="ghost" size="sm" className={hidden ? '' : 'md:hidden'} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </Button>
          <CommandBar />
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" aria-label="Full screen" title="Full screen (Esc to leave)" onClick={() => side.setFullScreen(true)}>
              <Maximize2 className="size-4" aria-hidden />
            </Button>
            <NotificationBell />
            <span className="hidden text-right text-xs leading-tight sm:block">
              <b className="block text-ink">{me.data.full_name}</b>
              <span className="text-muted capitalize">{me.data.role}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => void signOut()}><LogOut className="size-4" aria-hidden /> Sign out</Button>
          </div>
        </header>
        {side.fullScreen && (
          <Button variant="secondary" size="sm" className="fixed top-2 right-4 z-30" onClick={() => side.setFullScreen(false)}>
            <Minimize2 className="size-4" aria-hidden /> Exit full screen
          </Button>
        )}
        {preview.role && !side.fullScreen && (
          <div role="status" className="bg-accent-soft px-4 py-2 text-sm text-accent-ink" data-testid="preview-banner">
            Previewing as <b className="capitalize">{preview.role.replace('_', ' ')}</b> on {preview.env === 'test' ? 'Test' : 'Live'}. Read-only.
          </div>
        )}
        {!me.data.mfa_enabled && !preview.role && !side.fullScreen && (
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
