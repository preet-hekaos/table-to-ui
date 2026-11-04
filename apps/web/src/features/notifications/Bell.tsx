import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bell } from 'lucide-react'
import { useState } from 'react'
import { notifications } from '@/api/endpoints'
import { Button, Dialog, SideContent, EmptyState, LoadingState, Select, useToast } from '@/design-system'

const CHANNELS: [string, string][] = [
  ['in_app', 'In the app'],
  ['in_app_email', 'In the app and by email'],
  ['off', 'Off'],
]

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.round(m / 60)} h ago`
  return new Date(iso).toLocaleDateString()
}

/** The bell: unread count in the header, a list of what happened, and how I want to hear about it. */
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'list' | 'settings'>('list')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const inbox = useQuery({ queryKey: ['notifications'], queryFn: notifications.inbox, retry: false, refetchInterval: 30_000 })
  const unread = inbox.data?.unread ?? 0
  const refresh = () => Promise.all(['notifications', 'needs'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
  const markAll = useMutation({ mutationFn: () => notifications.read(), onSuccess: refresh })
  const markOne = useMutation({ mutationFn: (id: string) => notifications.read([id]), onSuccess: refresh })
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={() => {
          setView('list')
          setOpen(true)
        }}
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white" data-testid="bell-count">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <SideContent title={view === 'list' ? 'Notifications' : 'Notification settings'} description={view === 'list' ? 'What happened while you were away.' : 'Choose how you hear about each kind of update.'}>
          {view === 'settings' ? (
            <Settings onBack={() => setView('list')} />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={unread === 0 || markAll.isPending} onClick={() => markAll.mutate()}>
                  Mark all as read
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setView('settings')}>
                  Settings
                </Button>
              </div>
              {inbox.isLoading ? (
                <LoadingState label="Loading notifications" />
              ) : !inbox.data?.items.length ? (
                <EmptyState title="Nothing yet">Reminders and alerts from your automations will show up here.</EmptyState>
              ) : (
                <ul className="flex flex-col divide-y divide-line" aria-label="Notifications">
                  {inbox.data.items.map((n) => (
                    <li key={n.id} className="flex items-start gap-2 py-2" data-testid="notification">
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-accent'}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        {n.link ? (
                          <button
                            type="button"
                            className="text-left text-sm font-medium text-ink hover:underline"
                            onClick={() => {
                              if (!n.read) markOne.mutate(n.id)
                              setOpen(false)
                              void navigate({ to: n.link as never })
                            }}
                          >
                            {n.title}
                          </button>
                        ) : (
                          <p className="text-sm font-medium text-ink">{n.title}</p>
                        )}
                        <p className="text-xs text-muted">
                          {ago(n.created_at)}
                          {n.read ? '' : ' · unread'}
                        </p>
                      </div>
                      {!n.read && (
                        <Button size="sm" variant="ghost" aria-label={`Mark as read: ${n.title}`} onClick={() => markOne.mutate(n.id)}>
                          Read
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </SideContent>
      </Dialog>
    </>
  )
}

function Settings({ onBack }: { onBack: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const prefs = useQuery({ queryKey: ['notification-prefs'], queryFn: notifications.prefs, retry: false })
  const save = useMutation({
    mutationFn: notifications.savePrefs,
    onSuccess: async (r) => {
      qc.setQueryData(['notification-prefs'], r)
      toast({ title: 'Saved', tone: 'ok' })
    },
    onError: (e) => toast({ title: 'Could not save', description: (e as Error).message, tone: 'bad' }),
  })
  if (!prefs.data) return <LoadingState label="Loading settings" />
  return (
    <div className="flex flex-col gap-4">
      {prefs.data.kinds.map((k) => (
        <label key={k.kind} className="flex flex-col gap-1 text-sm text-ink">
          {k.label}
          <Select value={k.channel} onChange={(e) => save.mutate({ channels: { [k.kind]: e.target.value } })}>
            {CHANNELS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Select>
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={prefs.data.digest} onChange={(e) => save.mutate({ digest: e.target.checked })} />
        Email me one summary a day of anything I have not read
      </label>
      <Button variant="secondary" className="self-start" onClick={onBack}>Back to the list</Button>
    </div>
  )
}
