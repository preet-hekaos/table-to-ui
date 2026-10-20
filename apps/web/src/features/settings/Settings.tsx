import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { admin, app, type RoleRow } from '@/api/endpoints'
import { Badge, Button, Card, CardTitle, Field, Input, LoadingState, PermissionDenied, Select, Table, Tabs, TabsContent, TabsList, TabsTrigger, Td, Th, useToast } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'

const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong')

function People() {
  const qc = useQueryClient()
  const toast = useToast()
  const people = useQuery({ queryKey: ['people'], queryFn: admin.people })
  const roles = useQuery({ queryKey: ['roles'], queryFn: admin.roles })
  const refresh = () => qc.invalidateQueries({ queryKey: ['people'] })
  const active = useMutation({ mutationFn: (v: { id: string; on: boolean }) => admin.setActive(v.id, v.on), onSuccess: refresh, onError: (e) => toast({ title: errMsg(e), tone: 'bad' }) })
  const role = useMutation({ mutationFn: (v: { id: string; role: string }) => admin.setRole(v.id, v.role), onSuccess: refresh, onError: (e) => toast({ title: errMsg(e), tone: 'bad' }) })
  if (!people.data || !roles.data) return <LoadingState label="Loading people" />
  return (
    <Table aria-label="People">
      <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Teams</Th><Th>Status</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
      <tbody>
        {people.data.map((p) => (
          <tr key={p.id}>
            <Td>{p.full_name}</Td>
            <Td>{p.email}</Td>
            <Td>
              <Select aria-label={`Role for ${p.full_name}`} value={p.role} onChange={(e) => role.mutate({ id: p.id, role: e.target.value })}>
                {roles.data.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </Select>
            </Td>
            <Td>{p.teams.join(', ') || '—'}</Td>
            <Td><Badge tone={p.active ? 'ok' : 'neutral'}>{p.active ? 'Active' : 'Deactivated'}</Badge></Td>
            <Td><Button size="sm" variant="secondary" onClick={() => active.mutate({ id: p.id, on: !p.active })}>{p.active ? 'Deactivate' : 'Reactivate'}</Button></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

function Teams() {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')
  const teams = useQuery({ queryKey: ['teams'], queryFn: admin.teams })
  const people = useQuery({ queryKey: ['people'], queryFn: admin.people })
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['teams'] }), qc.invalidateQueries({ queryKey: ['people'] })])
  const create = useMutation({ mutationFn: () => admin.createTeam(name), onSuccess: () => { setName(''); return refresh() }, onError: (e) => toast({ title: errMsg(e), tone: 'bad' }) })
  const members = useMutation({ mutationFn: (v: { id: string; ids: string[] }) => admin.setMembers(v.id, v.ids), onSuccess: refresh })
  if (!teams.data || !people.data) return <LoadingState label="Loading teams" />
  return (
    <div className="flex flex-col gap-4">
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
        <Field label="New team"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Button type="submit" variant="primary" disabled={!name.trim()} loading={create.isPending}>Add team</Button>
      </form>
      {teams.data.map((t) => (
        <Card key={t.id}>
          <CardTitle>{t.name}</CardTitle>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Members of {t.name}</legend>
            {people.data.map((p) => (
              <label key={p.id} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={t.members.includes(p.id)} onChange={(e) => members.mutate({ id: t.id, ids: e.target.checked ? [...t.members, p.id] : t.members.filter((m) => m !== p.id) })} />
                {p.full_name}
              </label>
            ))}
          </fieldset>
        </Card>
      ))}
    </div>
  )
}

const ACTIONS = ['read', 'create', 'update'] as const

function Roles() {
  const qc = useQueryClient()
  const toast = useToast()
  const roles = useQuery({ queryKey: ['roles'], queryFn: admin.roles })
  const tables = useQuery({ queryKey: ['live-tables-full'], queryFn: async () => {
    const list = await app.tables()
    return Promise.all(list.tables.map(async (t) => (await app.table(t.key)).table))
  } })
  const [pick, setPick] = useState<string>('')
  const save = useMutation({
    mutationFn: (r: RoleRow) => admin.saveRole(r, false),
    onMutate: (r: RoleRow) => {
      // Optimistic: the grid shows the change at once and rolls back if the server refuses it.
      const before = qc.getQueryData<RoleRow[]>(['roles'])
      qc.setQueryData<RoleRow[]>(['roles'], (rows) => rows?.map((x) => (x.key === r.key ? r : x)))
      return { before }
    },
    onSuccess: () => { toast({ title: 'Saved. It applies on the next request.', tone: 'ok' }); return qc.invalidateQueries({ queryKey: ['roles'] }) },
    onError: (e, _r, ctx) => {
      qc.setQueryData(['roles'], ctx?.before)
      toast({ title: errMsg(e), tone: 'bad' })
    },
  })
  if (!roles.data || !tables.data) return <LoadingState label="Loading roles" />
  const editable = roles.data.filter((r) => r.key !== 'admin')
  const role = editable.find((r) => r.key === (pick || editable[0]?.key))
  if (!role) return <p className="text-sm text-muted">No other roles yet.</p>
  const has = (t: string, a: string) => role.grants.includes(`record.${t}.${a}`) || role.grants.includes(`record.*.${a}`) || role.grants.includes(`record.${t}.*`)
  const toggle = (t: string, a: string, on: boolean) => {
    // Expand a wildcard grant into explicit grants before turning one cell off.
    let grants = role.grants
    if (!on && grants.includes(`record.*.${a}`)) grants = [...grants.filter((g) => g !== `record.*.${a}`), ...tables.data.map((x) => `record.${x.key}.${a}`)]
    grants = on ? [...new Set([...grants, `record.${t}.${a}`])] : grants.filter((g) => g !== `record.${t}.${a}`)
    save.mutate({ ...role, grants })
  }
  const setScope = (t: string, scope: string) => save.mutate({ ...role, scopes: { ...role.scopes, [t]: scope } })
  const denied = (t: string, f: string) => role.field_deny.includes(`${t}.${f}`)
  const flipField = (t: string, f: string) =>
    save.mutate({ ...role, field_deny: denied(t, f) ? role.field_deny.filter((d) => d !== `${t}.${f}`) : [...role.field_deny, `${t}.${f}`] })
  return (
    <div className="flex flex-col gap-4">
      <Field label="Role"><Select value={role.key} onChange={(e) => setPick(e.target.value)}>{editable.map((r) => <option key={r.key} value={r.key}>{r.name} ({r.members})</option>)}</Select></Field>
      <p className="text-xs text-muted">The Administrator role always has full access and is not shown here.</p>
      <Table aria-label={`What ${role.name} can do`}>
        <thead><tr><Th>Table</Th>{ACTIONS.map((a) => <Th key={a}>{a[0]!.toUpperCase() + a.slice(1)}</Th>)}<Th>Sees</Th><Th>Hidden fields</Th></tr></thead>
        <tbody>
          {tables.data.map((t) => (
            <tr key={t.key}>
              <Td>{t.label}</Td>
              {ACTIONS.map((a) => (
                <Td key={a}><input type="checkbox" aria-label={`${role.name} can ${a} ${t.plural_label}`} checked={has(t.key, a)} onChange={(e) => toggle(t.key, a, e.target.checked)} /></Td>
              ))}
              <Td>
                <Select aria-label={`Which ${t.plural_label} ${role.name} sees`} value={role.scopes[t.key] ?? 'all'} onChange={(e) => setScope(t.key, e.target.value)}>
                  <option value="all">All</option><option value="own_team">Own and team</option><option value="own">Own only</option>
                </Select>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-2">
                  {t.fields.filter((f) => !f.hidden).map((f) => (
                    <label key={f.key} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={denied(t.key, f.key)} onChange={() => flipField(t.key, f.key)} />{f.label}</label>
                  ))}
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

function Branding() {
  const qc = useQueryClient()
  const toast = useToast()
  const s = useQuery({ queryKey: ['ws-settings'], queryFn: admin.settings })
  const [name, setName] = useState<string>()
  const [accent, setAccent] = useState<string>()
  const [err, setErr] = useState<string>()
  const [suggest, setSuggest] = useState<string>()
  const save = useMutation({
    mutationFn: () => admin.saveBrand({ app_name: name ?? s.data!.brand.app_name, accent: accent ?? s.data!.brand.accent }),
    onSuccess: () => { setErr(undefined); setSuggest(undefined); toast({ title: 'Branding saved', tone: 'ok' }); return qc.invalidateQueries({ queryKey: ['ws-settings'] }) },
    onError: (e) => { setErr(errMsg(e)); setSuggest((e as { body?: { suggestion?: string } }).body?.suggestion) },
  })
  if (!s.data) return <LoadingState label="Loading branding" />
  return (
    <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <Field label="App name"><Input value={name ?? s.data.brand.app_name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Accent colour" hint="White text must stay readable on it (4.5:1)." error={err}>
        <Input type="text" value={accent ?? s.data.brand.accent} onChange={(e) => setAccent(e.target.value)} />
      </Field>
      {suggest && <Button type="button" variant="secondary" onClick={() => { setAccent(suggest); setErr(undefined) }}>Use {suggest} instead</Button>}
      <Button type="submit" variant="primary" loading={save.isPending}>Save branding</Button>
    </form>
  )
}

function Regional() {
  const qc = useQueryClient()
  const toast = useToast()
  const s = useQuery({ queryKey: ['ws-settings'], queryFn: admin.settings })
  const [v, setV] = useState<Record<string, string>>({})
  const save = useMutation({ mutationFn: () => admin.saveRegional({ ...s.data!.regional, ...v }), onSuccess: () => { toast({ title: 'Regional settings saved', tone: 'ok' }); return qc.invalidateQueries({ queryKey: ['ws-settings'] }) } })
  if (!s.data) return <LoadingState label="Loading settings" />
  const val = (k: string) => v[k] ?? s.data!.regional[k] ?? ''
  return (
    <form className="flex max-w-md flex-col gap-4" onSubmit={(e) => { e.preventDefault(); save.mutate() }}>
      <Field label="Currency"><Select value={val('currency')} onChange={(e) => setV({ ...v, currency: e.target.value })}><option>INR</option><option>USD</option><option>GBP</option><option>EUR</option></Select></Field>
      <Field label="Week starts on"><Select value={val('week_start')} onChange={(e) => setV({ ...v, week_start: e.target.value })}><option value="monday">Monday</option><option value="sunday">Sunday</option><option value="saturday">Saturday</option></Select></Field>
      <Field label="Phone region"><Input value={val('phone_region')} onChange={(e) => setV({ ...v, phone_region: e.target.value })} /></Field>
      <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
    </form>
  )
}

/** Workspace settings: people, teams, roles and permissions, branding, regional formats. */
export function Settings() {
  const me = useMe()
  if (!me.data) return null
  if (!can(me.data.permissions, 'workspace.manage')) return <PermissionDenied what="Only workspace admins can change settings." />
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Settings</h1>
      <Tabs defaultValue="people">
        <TabsList aria-label="Settings sections">
          {['people', 'teams', 'roles', 'branding', 'regional'].map((t) => <TabsTrigger key={t} value={t}>{t[0]!.toUpperCase() + t.slice(1)}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="people" className="pt-4"><People /></TabsContent>
        <TabsContent value="teams" className="pt-4"><Teams /></TabsContent>
        <TabsContent value="roles" className="pt-4"><Roles /></TabsContent>
        <TabsContent value="branding" className="pt-4"><Branding /></TabsContent>
        <TabsContent value="regional" className="pt-4"><Regional /></TabsContent>
      </Tabs>
    </div>
  )
}
