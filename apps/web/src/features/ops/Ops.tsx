import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { LogOut, Building2, Package } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { ops, type WorkspaceRow } from '@/api/endpoints'
import { tokens } from '@/api/session'
import { Badge, Button, Card, Dialog, DialogContent, EmptyState, ErrorState, Field, Input, LoadingState, Select, Table, Td, Th, useToast } from '@/design-system'
import { AuthLayout } from '@/features/auth/AuthLayout'

/** Screen 0.1: operator sign-in. A separate realm: password, then an authenticator code. */
export function OpsSignIn() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'password' | 'code'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      if (step === 'password') {
        const r = await ops.signIn({ email, password })
        setPending(r.token)
        setStep('code')
      } else {
        await ops.verify(code, pending)
        tokens.setOps(pending)
        await navigate({ to: '/ops/workspaces' })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Operator sign-in" subtitle="For platform staff only. This is separate from every customer workspace.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        {step === 'password' ? (
          <>
            <Field label="Staff email" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </Field>
            <Field label="Password" required error={error}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            </Field>
          </>
        ) : (
          <Field label="Authenticator code" required error={error}>
            <Input inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
          </Field>
        )}
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          {step === 'password' ? 'Continue' : 'Sign in'}
        </Button>
      </form>
    </AuthLayout>
  )
}

export function OpsShell() {
  const navigate = useNavigate()
  if (!tokens.getOps()) {
    void navigate({ to: '/ops/sign-in' })
    return null
  }
  return (
    <div className="flex h-full">
      <aside className="flex w-52 flex-col gap-3 bg-nav p-3">
        <div className="px-1 text-sm font-bold text-white">
          Table to UI <span className="block text-[10px] tracking-wide text-warn uppercase">Operations</span>
        </div>
        <nav aria-label="Operations">
          {[
            { to: '/ops/workspaces', label: 'Workspaces', icon: <Building2 className="size-4" aria-hidden /> },
            { to: '/ops/tenants', label: 'Tenants', icon: <Building2 className="size-4" aria-hidden /> },
            { to: '/ops/packs', label: 'Packs', icon: <Package className="size-4" aria-hidden /> },
          ].map((l) => (
            <Link
              key={l.to}
              to={l.to}
              className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-nav-text hover:text-white"
              activeProps={{ className: 'bg-nav-active !text-white font-semibold', 'aria-current': 'page' }}
            >
              {l.icon} {l.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center border-b border-line bg-surface px-4">
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => {
              tokens.setOps(null)
              void navigate({ to: '/ops/sign-in' })
            }}
          >
            <LogOut className="size-4" aria-hidden /> Sign out
          </Button>
        </header>
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

/** Screen 0.2: the tenant directory. Metadata about agencies only; no business records. */
export function TenantDirectory() {
  const q = useQuery({ queryKey: ['ops-tenants'], queryFn: ops.tenants, retry: false })
  if (q.isLoading) return <LoadingState label="Loading tenants" />
  if (q.isError) return <ErrorState requestId={(q.error as ApiError).requestId} onRetry={() => void q.refetch()} />
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Tenants</h1>
      {q.data?.length ? (
        <Table aria-label="Tenants">
          <thead>
            <tr>
              <Th>Workspace</Th>
              <Th>Plan</Th>
              <Th>Cluster</Th>
              <Th>Schema</Th>
              <Th>Created</Th>
              <Th>Health</Th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((t) => (
              <tr key={t.id}>
                <Td className="font-semibold text-ink">{t.name}</Td>
                <Td className="capitalize">{t.plan}</Td>
                <Td>{t.cluster}</Td>
                <Td className="font-mono text-xs">{t.schema}</Td>
                <Td>{new Date(t.created_at).toLocaleDateString()}</Td>
                <Td><Badge tone={t.health === 'healthy' ? 'ok' : 'warn'}>{t.health}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="No agencies yet" />
      )}
    </div>
  )
}

/** Screen 0.4: the pack catalog. A version is published only when its fixtures pass (S27). */
export function PackCatalog() {
  const qc = useQueryClient()
  const toast = useToast()
  const packs = useQuery({ queryKey: ['ops-packs'], queryFn: ops.packs })
  const [results, setResults] = useState<Record<string, { passed: boolean; id: string; title: string; detail: string }[]>>({})
  const publish = useMutation({
    mutationFn: (id: string) => ops.publish(id),
    onSuccess: async (r) => {
      toast({ title: `Published ${r.pack_id} ${r.version}`, description: `${r.fixtures.passed} of ${r.fixtures.total} fixtures passed.`, tone: 'ok' })
      await qc.invalidateQueries({ queryKey: ['ops-packs'] })
    },
    onError: (e, id) => {
      const body = (e as ApiError).body as { fixtures?: { results: { passed: boolean; id: string; title: string; detail: string }[] } } | undefined
      if (body?.fixtures) setResults({ ...results, [id]: body.fixtures.results })
      toast({ title: 'Not published', description: (e as Error).message, tone: 'bad' })
    },
  })
  if (packs.isLoading) return <LoadingState label="Loading packs" />
  if (packs.error) return <ErrorState requestId={(packs.error as ApiError).requestId} onRetry={() => void packs.refetch()} />
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Packs</h1>
      <Table aria-label="Packs">
        <thead><tr><Th>Pack</Th><Th>On disk</Th><Th>Compatible with</Th><Th>Fixtures</Th><Th>Published</Th><Th><span className="sr-only">Publish</span></Th></tr></thead>
        <tbody>
          {packs.data?.map((p) => (
            <tr key={p.id}>
              <Td className="font-semibold text-ink">{p.title}</Td>
              <Td>{p.version}</Td>
              <Td><code>{p.compatible_with}</code></Td>
              <Td>{p.fixtures}</Td>
              <Td>{p.published.map((x) => x.version).join(', ') || 'Not yet'}</Td>
              <Td>
                {p.is_published ? <Badge tone="ok">Published</Badge> : <Button size="sm" variant="primary" onClick={() => publish.mutate(p.id)} loading={publish.isPending && publish.variables === p.id}>Publish {p.version}</Button>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {Object.entries(results).map(([id, rs]) => (
        <Card key={id}>
          <h2 className="text-sm font-bold text-ink">Fixtures for {id}</h2>
          <ul className="mt-2 text-sm">
            {rs.map((r) => <li key={r.id}><Badge tone={r.passed ? 'ok' : 'bad'}>{r.passed ? 'Pass' : 'Fail'}</Badge> <b>{r.id}</b> {r.title} {!r.passed && <span className="text-bad-ink">— {r.detail}</span>}</li>)}
          </ul>
        </Card>
      ))}
    </div>
  )
}

const STATUS_LABEL: Record<WorkspaceRow['status'], string> = {
  provisioning: 'Setting up',
  active: 'Active',
  suspended: 'Suspended',
  scheduled_deletion: 'Scheduled for deletion',
}
const STATUS_TONE: Record<WorkspaceRow['status'], 'ok' | 'warn' | 'bad' | 'neutral'> = {
  provisioning: 'neutral',
  active: 'ok',
  suspended: 'warn',
  scheduled_deletion: 'bad',
}

type Action = { kind: 'suspend' | 'export' | 'delete' | 'limits'; ws: WorkspaceRow }

/** Screen 0.3: every client workspace, with counts only. Never record contents. */
export function WorkspaceConsole() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['ops-workspaces'], queryFn: ops.workspaces, retry: false })
  const [action, setAction] = useState<Action | null>(null)
  const [creating, setCreating] = useState(false)
  const refresh = () => qc.invalidateQueries({ queryKey: ['ops-workspaces'] })
  const fail = (e: unknown) => toast({ title: e instanceof Error ? e.message : 'Something went wrong', tone: 'bad' })
  const resume = useMutation({ mutationFn: (id: string) => ops.resume(id), onSuccess: async () => { toast({ title: 'Workspace resumed', tone: 'ok' }); await refresh() }, onError: fail })
  const cancel = useMutation({ mutationFn: (id: string) => ops.cancelDelete(id), onSuccess: async () => { toast({ title: 'Deletion canceled. The workspace is suspended.', tone: 'ok' }); await refresh() }, onError: fail })

  if (q.isLoading) return <LoadingState label="Loading workspaces" />
  if (q.isError) return <ErrorState requestId={(q.error as ApiError).requestId} onRetry={() => void q.refetch()} />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-ink">Workspaces</h1>
        <Button variant="primary" size="sm" className="ml-auto" onClick={() => setCreating(true)}>New workspace</Button>
      </div>
      {q.data?.length ? (
        <Table aria-label="Workspaces">
          <thead>
            <tr><Th>Workspace</Th><Th>Pack</Th><Th>Status</Th><Th>People</Th><Th>Records</Th><Th>Storage</Th><Th>Last activity</Th><Th><span className="sr-only">Actions</span></Th></tr>
          </thead>
          <tbody>
            {q.data.map((w) => (
              <tr key={w.id}>
                <Td className="font-semibold text-ink">
                  {w.name}
                  <span className="block text-xs font-normal text-muted">{w.owner_email ?? 'No owner'}</span>
                </Td>
                <Td>{w.pack ?? 'Blank'}</Td>
                <Td>
                  <Badge tone={STATUS_TONE[w.status]}>{STATUS_LABEL[w.status]}</Badge>
                  {w.status === 'scheduled_deletion' && w.delete_after && (
                    <span className="block text-xs text-muted">Deleted {new Date(w.delete_after).toLocaleDateString()}</span>
                  )}
                  {w.status === 'suspended' && w.reason && <span className="block text-xs text-muted">{w.reason}</span>}
                </Td>
                <Td>{w.people}{w.limits.max_people != null && ` / ${w.limits.max_people}`}</Td>
                <Td>{w.records}{w.limits.max_records != null && ` / ${w.limits.max_records}`}</Td>
                <Td>{w.storage_mb} MB</Td>
                <Td>{w.last_activity ? new Date(w.last_activity).toLocaleDateString() : 'Never'}</Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    {w.status === 'active' && <Button size="sm" variant="secondary" aria-label={`Suspend ${w.name}`} onClick={() => setAction({ kind: 'suspend', ws: w })}>Suspend</Button>}
                    {w.status === 'suspended' && (
                      <>
                        <Button size="sm" variant="secondary" aria-label={`Resume ${w.name}`} loading={resume.isPending && resume.variables === w.id} onClick={() => resume.mutate(w.id)}>Resume</Button>
                        <Button size="sm" variant="secondary" aria-label={`Delete ${w.name}`} onClick={() => setAction({ kind: 'delete', ws: w })}>Delete…</Button>
                      </>
                    )}
                    {w.status === 'scheduled_deletion' && <Button size="sm" variant="secondary" aria-label={`Cancel deletion of ${w.name}`} loading={cancel.isPending && cancel.variables === w.id} onClick={() => cancel.mutate(w.id)}>Cancel deletion</Button>}
                    {w.status !== 'provisioning' && <Button size="sm" variant="secondary" aria-label={`Export ${w.name}`} onClick={() => setAction({ kind: 'export', ws: w })}>Export</Button>}
                    <Button size="sm" variant="secondary" aria-label={`Limits for ${w.name}`} onClick={() => setAction({ kind: 'limits', ws: w })}>Limits</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="No client workspaces yet" />
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent title="New workspace" description="The owner gets an invitation by email and full access to this workspace only.">
          <NewWorkspaceForm onDone={async () => { setCreating(false); await refresh() }} />
        </DialogContent>
      </Dialog>
      <Dialog open={action !== null} onOpenChange={(o) => !o && setAction(null)}>
        {action && (
          <DialogContent
            title={{ suspend: `Suspend ${action.ws.name}`, export: `Export ${action.ws.name}`, delete: `Delete ${action.ws.name}`, limits: `Limits for ${action.ws.name}` }[action.kind]}
            description={{
              suspend: 'Everyone in this workspace is signed out now and cannot sign in until you resume it.',
              export: 'Sends a download link to the workspace owner. The link expires in 24 hours.',
              delete: 'Starts a grace period. After it ends, everything in the workspace is permanently erased.',
              limits: 'Leave a box empty for no limit. Only the new thing is blocked when a limit is reached.',
            }[action.kind]}
          >
            {action.kind === 'limits' ? (
              <LimitsForm ws={action.ws} onDone={async () => { setAction(null); await refresh() }} />
            ) : (
              <ReasonForm kind={action.kind} ws={action.ws} onDone={async () => { setAction(null); await refresh() }} />
            )}
          </DialogContent>
        )}
      </Dialog>
    </div>
  )
}

function NewWorkspaceForm({ onDone }: { onDone: () => void | Promise<void> }) {
  const toast = useToast()
  const packs = useQuery({ queryKey: ['ops-packs'], queryFn: ops.packs })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pack, setPack] = useState('')
  const [error, setError] = useState<string>()
  const [link, setLink] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => ops.createWorkspace({ name, owner_email: email, pack_id: pack || null }),
    onSuccess: async (r) => {
      toast({ title: `Created ${name}. Invitation sent to ${email}.`, tone: 'ok' })
      if (r.invite_link) setLink(r.invite_link)
      else await onDone()
    },
    onError: (e) => setError(e.message),
  })
  if (link) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-md bg-soft p-2 text-xs break-all" data-testid="owner-invite-link"><b>Local development only:</b> {link}</p>
        <Button variant="primary" onClick={() => void onDone()}>Done</Button>
      </div>
    )
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(undefined); create.mutate() }} className="flex flex-col gap-4">
      <Field label="Workspace name" required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Owner email" required error={error}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Start from">
        <Select value={pack} onChange={(e) => setPack(e.target.value)}>
          <option value="">Blank workspace</option>
          {packs.data?.filter((p) => p.is_published).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </Select>
      </Field>
      <Button type="submit" variant="primary" loading={create.isPending}>Create workspace</Button>
    </form>
  )
}

function ReasonForm({ kind, ws, onDone }: { kind: 'suspend' | 'export' | 'delete'; ws: WorkspaceRow; onDone: () => void | Promise<void> }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState('')
  const [grace, setGrace] = useState('7')
  const [error, setError] = useState<string>()
  const [link, setLink] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () =>
      kind === 'suspend'
        ? ops.suspend(ws.id, reason)
        : kind === 'export'
          ? ops.exportWorkspace(ws.id, reason)
          : ops.scheduleDelete(ws.id, { confirm_name: confirm, reason, grace_days: Number(grace) }),
    onSuccess: async (r) => {
      const done = { suspend: 'Workspace suspended', export: 'Export sent to the workspace owner', delete: `Deletion scheduled in ${grace} days` }[kind]
      toast({ title: done, tone: 'ok' })
      const dl = (r as { download_link?: string }).download_link
      if (kind === 'export' && dl) setLink(dl)
      else await onDone()
    },
    onError: (e) => setError(e.message),
  })
  if (link) {
    return (
      <div className="flex flex-col gap-3">
        <p className="rounded-md bg-soft p-2 text-xs break-all" data-testid="export-link"><b>Local development only:</b> {link}</p>
        <Button variant="primary" onClick={() => void onDone()}>Done</Button>
      </div>
    )
  }
  const label = { suspend: 'Suspend workspace', export: 'Send export', delete: 'Schedule deletion' }[kind]
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(undefined); run.mutate() }} className="flex flex-col gap-4">
      {kind === 'delete' && (
        <>
          <Field label={`Type "${ws.name}" to confirm`} required><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" /></Field>
          <Field label="Grace period (days)" hint="You can cancel until it ends." required><Input type="number" min={0} max={90} value={grace} onChange={(e) => setGrace(e.target.value)} /></Field>
        </>
      )}
      <Field label="Reason" required error={error}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <Button type="submit" variant="primary" loading={run.isPending}>{label}</Button>
    </form>
  )
}

function LimitsForm({ ws, onDone }: { ws: WorkspaceRow; onDone: () => void | Promise<void> }) {
  const toast = useToast()
  const keys = [
    ['max_people', 'People'],
    ['max_records', 'Records'],
    ['max_storage_mb', 'Storage (MB)'],
    ['ai_monthly_tokens', 'AI tokens per month'],
  ] as const
  const [v, setV] = useState<Record<string, string>>(Object.fromEntries(keys.map(([k]) => [k, ws.limits[k] == null ? '' : String(ws.limits[k])])))
  const [error, setError] = useState<string>()
  const save = useMutation({
    mutationFn: () => ops.setLimits(ws.id, Object.fromEntries(keys.map(([k]) => [k, v[k] === '' ? null : Number(v[k])]))),
    onSuccess: async () => { toast({ title: 'Limits saved', tone: 'ok' }); await onDone() },
    onError: (e) => setError(e.message),
  })
  return (
    <form onSubmit={(e) => { e.preventDefault(); setError(undefined); save.mutate() }} className="flex flex-col gap-4">
      {keys.map(([k, label], i) => (
        <Field key={k} label={label} error={i === 0 ? error : undefined}>
          <Input type="number" min={0} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
        </Field>
      ))}
      <Button type="submit" variant="primary" loading={save.isPending}>Save limits</Button>
    </form>
  )
}
