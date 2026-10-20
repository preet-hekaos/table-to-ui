import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Outlet, useNavigate } from '@tanstack/react-router'
import { LogOut, Building2, Package } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { ApiError } from '@/api/client'
import { ops } from '@/api/endpoints'
import { tokens } from '@/api/session'
import { Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Table, Td, Th, useToast } from '@/design-system'
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
        await navigate({ to: '/ops/tenants' })
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
