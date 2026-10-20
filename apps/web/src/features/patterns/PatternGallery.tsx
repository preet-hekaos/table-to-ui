import type { ColumnDef } from '@tanstack/react-table'
import { useState } from 'react'
import type { RecordRow, TableDef } from '@/api/types'
import {
  AiUnavailable,
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
  NotFound,
  PermissionDenied,
  RuleBlocked,
  VersionConflict,
  cn,
} from '@/design-system'
import { ProfileFields } from '@/patterns/ProfilePage'
import { RecordForm } from '@/patterns/RecordForm'
import { SearchableTable } from '@/patterns/SearchableTable'
import { formatField } from '@/patterns/format'

/** M1-S26: the seven screen patterns with all eight shared states, for sign-off beside the mockups.
 *  Sample data only: nothing here talks to the API. */

const TABLE: TableDef = {
  key: 'person',
  label: 'Person',
  plural_label: 'People',
  title_field: 'full_name',
  groups: [
    { key: 'who', label: 'Who' },
    { key: 'work', label: 'Work' },
  ],
  fields: [
    { key: 'full_name', label: 'Full name', type: 'text', required: true, group: 'who', options: [], default: null, min: null, max: null, max_length: 200, normalize: null, unique: false },
    { key: 'email', label: 'Email', type: 'email', required: true, group: 'who', options: [], default: null, min: null, max: null, max_length: null, normalize: null, unique: false },
    { key: 'city', label: 'City', type: 'text', required: false, group: 'work', options: [], default: null, min: null, max: null, max_length: null, normalize: null, unique: false },
    { key: 'experience', label: 'Experience', type: 'months', required: false, group: 'work', options: [], default: null, min: null, max: null, max_length: null, normalize: null, unique: false },
    { key: 'pay', label: 'Expected pay', type: 'money', required: false, group: 'work', options: [], default: null, min: null, max: null, max_length: null, normalize: null, unique: false },
    { key: 'status', label: 'Status', type: 'select', required: true, group: 'work', options: ['Active', 'Placed', 'Archived'], default: 'Active', min: null, max: null, max_length: null, normalize: null, unique: false },
  ],
}

const ROWS: RecordRow[] = [
  ['Arjun Menon', 'arjun.menon@gmail.com', 'Bengaluru', 63, 1250000, 'Active'],
  ['Priya Nair', 'priya.nair@outlook.com', 'Pune', 30, 900000, 'Active'],
  ['Rohan Shah', 'rohan.shah@yahoo.co.in', 'Mumbai', 120, 2800000, 'Placed'],
].map(([full_name, email, city, experience, pay, status], i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  table: 'person',
  version: 1,
  data: { full_name, email, city, experience, pay, status },
  created_at: '2026-10-19T09:00:00Z',
  updated_at: '2026-10-19T09:00:00Z',
  owner: { id: 'x', name: 'Ananya Rao' },
}))

const STATES = ['Ready', 'Loading', 'Empty', 'Error', 'No access', 'Not found', 'Blocked by a rule', 'Changed by someone else', 'AI unavailable'] as const
type State = (typeof STATES)[number]

const PATTERNS = ['Searchable table', 'Profile', 'Master-detail', 'Form', 'Ranked list', 'Document review', 'Detail'] as const

const columns: ColumnDef<RecordRow, unknown>[] = TABLE.fields.map((f) => ({
  id: f.key,
  header: f.label,
  cell: ({ row }) =>
    f.key === 'status' ? <Badge tone={row.original.data.status === 'Active' ? 'ok' : 'neutral'}>{String(row.original.data.status)}</Badge> : formatField(f, row.original.data[f.key]),
}))

function Ready({ pattern }: { pattern: (typeof PATTERNS)[number] }) {
  const [picked, setPicked] = useState(ROWS[0]!.id)
  const one = ROWS.find((r) => r.id === picked)!
  switch (pattern) {
    case 'Searchable table':
      return <SearchableTable caption="People" columns={columns} rows={ROWS} sort={{ key: 'updated_at', direction: 'desc' }} onSort={() => undefined} sortableKeys={new Set(['full_name', 'city'])} hasMore={false} onLoadMore={() => undefined} />
    case 'Profile':
      return (
        <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
          <ProfileFields table={TABLE} data={one.data} />
          <Card>
            <CardTitle>Recent activity</CardTitle>
            <ol className="mt-2 text-sm text-body"><li>18 Oct 2026 · Call: Intro call</li><li>19 Oct 2026 · Created</li></ol>
          </Card>
        </div>
      )
    case 'Master-detail':
      return (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <ul className="flex flex-col gap-0.5" aria-label="People">
            {ROWS.map((r) => (
              <li key={r.id}>
                <button type="button" aria-current={r.id === picked ? 'true' : undefined} onClick={() => setPicked(r.id)} className={cn('w-full rounded-md px-3 py-2 text-left text-sm', r.id === picked ? 'bg-accent-soft font-semibold text-accent-ink' : 'hover:bg-soft')}>
                  {String(r.data.full_name)}
                </button>
              </li>
            ))}
          </ul>
          <ProfileFields table={TABLE} data={one.data} />
        </div>
      )
    case 'Form':
      return <RecordForm table={TABLE} onCreated={() => undefined} save={async () => ({ id: 'sample' })} review={new Set(['city'])} submitLabel="Save person" />
    case 'Ranked list':
      return (
        <ol className="flex flex-col gap-2" aria-label="Ranked people">
          {ROWS.map((r, i) => (
            <li key={r.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-center gap-3">
                <span className="w-5 text-right text-sm font-bold text-muted">{i + 1}</span>
                <b className="text-ink">{String(r.data.full_name)}</b>
                <span className="ml-auto text-lg font-bold text-ink">{90 - i * 17}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                {['Skills', 'Experience', 'Location'].map((p, j) => (
                  <div key={p}>
                    <div className="flex justify-between text-muted"><span>{p}</span><span>{30 - j * 10 - i * 3}</span></div>
                    <div className="mt-1 h-1.5 rounded bg-soft" aria-hidden><div className="h-1.5 rounded bg-accent" style={{ width: `${90 - i * 25}%` }} /></div>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )
    case 'Document review':
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          <pre className="h-64 overflow-auto rounded-md border border-line bg-surface p-3 text-xs whitespace-pre-wrap text-body" aria-label="Document text">
            {'ARJUN MENON\nSenior Software Engineer\narjun.menon@gmail.com | +91 98450 12345\nLocation: Bengaluru\n\nSkills\nJava, Spring Boot, Kafka'}
          </pre>
          <RecordForm table={TABLE} onCreated={() => undefined} save={async () => ({ id: 'sample' })} prefill={{ full_name: 'Arjun Menon', email: 'arjun.menon@gmail.com', city: 'Bengaluru' }} review={new Set(['city'])} submitLabel="Save person" />
        </div>
      )
    default:
      return <ProfileFields table={TABLE} data={one.data} />
  }
}

function InState({ pattern, state }: { pattern: (typeof PATTERNS)[number]; state: State }) {
  switch (state) {
    case 'Loading':
      return <LoadingState label={`Loading ${pattern.toLowerCase()}`} />
    case 'Empty':
      return <EmptyState title="No people yet" action={<Button variant="primary">Add person</Button>}>Records you add here appear in this list, newest changes first.</EmptyState>
    case 'Error':
      return <ErrorState requestId="req_8f2c1a" onRetry={() => undefined} />
    case 'No access':
      return <PermissionDenied />
    case 'Not found':
      return <NotFound what="record" />
    case 'Blocked by a rule':
      return <RuleBlocked ruleId="R-01" message="A person with this email already exists." link={<a className="underline" href="#">Open Arjun Menon</a>} />
    case 'Changed by someone else':
      return <VersionConflict onReload={() => undefined} />
    case 'AI unavailable':
      return <AiUnavailable />
    default:
      return <Ready pattern={pattern} />
  }
}

export function PatternGallery() {
  const [pattern, setPattern] = useState<(typeof PATTERNS)[number]>('Searchable table')
  const [state, setState] = useState<State>('Ready')
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Screen patterns</h1>
        <p className="text-sm text-muted">The seven patterns every screen is built from, each with the eight shared states. Sample data; for sign-off beside the mockups.</p>
      </div>
      <div role="tablist" aria-label="Pattern" className="flex flex-wrap gap-1">
        {PATTERNS.map((p) => (
          <button key={p} role="tab" type="button" aria-selected={p === pattern} onClick={() => setPattern(p)} className={cn('rounded-md px-3 py-1.5 text-sm font-semibold', p === pattern ? 'bg-accent text-white' : 'bg-soft text-body hover:bg-line')}>
            {p}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="State" className="flex flex-wrap gap-1">
        {STATES.map((s) => (
          <label key={s} className={cn('cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold', s === state ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line text-body')}>
            <input type="radio" name="state" className="sr-only" checked={s === state} onChange={() => setState(s)} />
            {s}
          </label>
        ))}
      </div>
      <section aria-label={`${pattern}, ${state}`} className="rounded-lg border border-dashed border-line bg-canvas p-4" data-testid="pattern-stage">
        <InState pattern={pattern} state={state} />
      </section>
    </div>
  )
}
