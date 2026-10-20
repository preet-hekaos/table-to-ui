import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { admin, studio } from '@/api/endpoints'
import { Badge, Button, Card, Field, Select } from '@/design-system'

const DEVICES = {
  phone: { label: 'Phone', w: 390, h: 760 },
  desktop: { label: 'Desktop', w: 1280, h: 800 },
} as const

interface FixtureRun {
  environment: string
  release_version: number
  total: number
  passed: number
  failed: number
  results: { id: string; title: string; expected: string; outcome: string; passed: boolean; detail: string }[]
}

/** Screen 2.15: the app as each role would see it, on a phone or a desktop, plus the pack's fixtures. */
export function PreviewTab() {
  const roles = useQuery({ queryKey: ['roles'], queryFn: admin.roles, retry: false })
  const [role, setRole] = useState('recruiter')
  const [env, setEnv] = useState<'test' | 'live'>('test')
  const [device, setDevice] = useState<keyof typeof DEVICES>('desktop')
  const run = useMutation({ mutationFn: () => studio.runFixtures(env) as Promise<FixtureRun> })
  const d = DEVICES[device]
  const scale = device === 'desktop' ? 0.6 : 0.85
  const src = `/?preview_role=${encodeURIComponent(role)}&preview_env=${env}`
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field label="See it as">
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {(roles.data ?? []).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="Version">
            <Select value={env} onChange={(e) => setEnv(e.target.value as 'test' | 'live')}>
              <option value="test">Test</option>
              <option value="live">Live</option>
            </Select>
          </Field>
        </div>
        <div role="group" aria-label="Device" className="flex gap-1">
          {(Object.keys(DEVICES) as (keyof typeof DEVICES)[]).map((k) => (
            <Button key={k} size="sm" variant={device === k ? 'primary' : 'secondary'} aria-pressed={device === k} onClick={() => setDevice(k)}>
              {DEVICES[k].label}
            </Button>
          ))}
        </div>
        <Button className="ml-auto" onClick={() => run.mutate()} loading={run.isPending}>
          Run pack fixtures on {env === 'test' ? 'Test' : 'Live'}
        </Button>
      </div>
      {run.error && <p role="alert" className="text-sm text-bad-ink">{(run.error as Error).message}</p>}
      {run.data && (
        <Card data-testid="fixture-results">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-ink">Fixtures on version {run.data.release_version}</h2>
            <Badge tone={run.data.failed ? 'bad' : 'ok'}>
              {run.data.passed} of {run.data.total} passed
            </Badge>
          </div>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {run.data.results.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={r.passed ? 'ok' : 'bad'}>{r.passed ? 'Pass' : 'Fail'}</Badge>
                <b className="text-ink">{r.id}</b> {r.title}
                {!r.passed && <span className="text-bad-ink">— {r.detail}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="overflow-auto rounded-lg border border-line bg-soft p-4">
        <div style={{ width: d.w * scale, height: d.h * scale }} className="mx-auto">
          <iframe
            key={src}
            title={`The app as ${role} on ${d.label.toLowerCase()}`}
            src={src}
            width={d.w}
            height={d.h}
            style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}
            className="rounded-md border border-line bg-surface"
          />
        </div>
      </div>
    </div>
  )
}
