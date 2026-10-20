/** The eight screen states every page must handle. Shared so every screen looks and reads the same. */
import { AlertTriangle, FileQuestion, Inbox, Lock, RefreshCw, ShieldAlert, Sparkles, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../Button'
import { Skeleton } from '../Skeleton'

function Panel({ icon: Icon, title, children, tone = 'text-muted', role }: { icon: LucideIcon; title: string; children?: ReactNode; tone?: string; role?: 'alert' | 'status' }) {
  return (
    <div role={role} className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface px-6 py-10 text-center">
      <Icon className={`size-8 ${tone}`} aria-hidden />
      <h2 className="text-base font-bold text-ink">{title}</h2>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  )
}

export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-2">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <Panel icon={Inbox} title={title}>
      {children}
      {action && <div className="mt-3">{action}</div>}
    </Panel>
  )
}

export function ErrorState({ requestId, onRetry, message }: { requestId?: string; onRetry?: () => void; message?: string }) {
  return (
    <Panel icon={AlertTriangle} title="Something went wrong" tone="text-bad" role="alert">
      <p>{message ?? 'We could not load this. Nothing was changed.'}</p>
      {requestId && <p className="mt-1 font-mono text-xs">Request id: {requestId}</p>}
      {onRetry && (
        <Button className="mt-3" onClick={onRetry}>
          <RefreshCw className="size-4" aria-hidden /> Try again
        </Button>
      )}
    </Panel>
  )
}

export function PermissionDenied({ what }: { what?: string }) {
  return (
    <Panel icon={Lock} title="You do not have access" role="alert">
      {what ?? 'Your role does not allow this. Ask your workspace admin if you need it.'}
    </Panel>
  )
}

export function RuleBlocked({ ruleId, message, link }: { ruleId: string; message: string; link?: ReactNode }) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-bad bg-bad-soft p-3 text-bad-ink">
      <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-sm">
        <p className="font-semibold">
          Blocked by rule {ruleId}
        </p>
        <p>{message}</p>
        {link && <p className="mt-1 font-semibold">{link}</p>}
      </div>
    </div>
  )
}

export function VersionConflict({ onReload }: { onReload: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-lg border border-warn bg-warn-soft p-3 text-warn-ink">
      <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="text-sm">
        <p className="font-semibold">Someone else changed this record</p>
        <p>Your changes were not saved. Reload to see the latest version, then apply your edits again.</p>
        <Button className="mt-2" size="sm" onClick={onReload}>
          Reload latest
        </Button>
      </div>
    </div>
  )
}

export function AiUnavailable() {
  return (
    <Panel icon={Sparkles} title="AI help is unavailable right now" role="status">
      Everything else works as normal. You can carry on manually and try the assistant again later.
    </Panel>
  )
}

export function NotFound({ what = 'page' }: { what?: string }) {
  return (
    <Panel icon={FileQuestion} title={`We could not find that ${what}`} role="status">
      It may have been removed, or the link may be wrong.
    </Panel>
  )
}
