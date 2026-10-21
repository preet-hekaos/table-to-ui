import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ApiError } from '@/api/client'
import { studio } from '@/api/endpoints'
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Select, useToast } from '@/design-system'

const SEVERITIES = [
  ['block', 'Stop it'],
  ['approval', 'Ask a manager'],
  ['warn', 'Warn only'],
] as const

/** Stages and policies: rename stages, add a stage, and decide how strict each pack policy is. Saved to Draft. */
export function FlowTab({ canEdit }: { canEdit: boolean }) {
  const tables = useQuery({ queryKey: ['studio-tables'], queryFn: studio.tables, retry: false })
  const rules = useQuery({ queryKey: ['studio-rules'], queryFn: studio.rules, retry: false })
  if (tables.isError) return <ErrorState requestId={(tables.error as ApiError).requestId} onRetry={() => void tables.refetch()} />
  if (!tables.data || !rules.data) return <LoadingState label="Loading stages and policies" />
  const staged = tables.data.filter((t) => t.workflow)
  const policies = rules.data.flatMap((r) => r.checks.filter((c) => c.editable).map((c) => ({ rule: r.id, ...c })))
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">Changes stay in Draft until you publish. Stage names you see can change; the stored value never does.</p>
      {staged.length === 0 && <EmptyState title="No tables with stages" />}
      {staged.map((t) => (
        <StagesCard key={t.key + JSON.stringify(t.workflow)} table={t.key} title={t.plural_label ?? t.label} stages={t.workflow!.stages} canEdit={canEdit} />
      ))}
      <Card className="p-0">
        <h2 className="border-b border-line p-3 text-sm font-bold text-ink">Policies</h2>
        <ul className="divide-y divide-line" aria-label="Policies">
          {policies.map((p) => (
            <PolicyRow key={p.id + p.severity} policy={p} canEdit={canEdit} />
          ))}
        </ul>
      </Card>
    </div>
  )
}

function StagesCard({ table, title, stages, canEdit }: { table: string; title: string; stages: { key: string; label?: string | null; end?: boolean }[]; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [labels, setLabels] = useState<Record<string, string>>(Object.fromEntries(stages.map((s) => [s.key, s.label ?? s.key])))
  const [name, setName] = useState('')
  const [after, setAfter] = useState(stages.find((s) => !s.end)?.key ?? '')
  const save = useMutation({
    mutationFn: (add?: { key: string; after: string }) => {
      const changed = Object.fromEntries(stages.filter((s) => labels[s.key] !== (s.label ?? s.key)).map((s) => [s.key, labels[s.key]!]))
      return studio.saveStages(table, { labels: changed, add })
    },
    onSuccess: async () => {
      toast({ title: 'Stages saved in Draft', description: 'Publish to show them to everyone.', tone: 'ok' })
      setName('')
      await Promise.all(['studio-tables', 'studio-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: (e) => toast({ title: 'Could not save the stages', description: (e as Error).message, tone: 'bad' }),
  })
  const dirty = stages.some((s) => labels[s.key] !== (s.label ?? s.key))
  return (
    <Card className="p-0">
      <h2 className="border-b border-line p-3 text-sm font-bold text-ink">{title} stages</h2>
      <ul className="divide-y divide-line" aria-label={`${title} stages`}>
        {stages.map((s) => (
          <li key={s.key} className="flex flex-wrap items-center gap-2 p-3">
            <Input aria-label={`Label for stage ${s.key}`} value={labels[s.key] ?? ''} disabled={!canEdit} onChange={(e) => setLabels({ ...labels, [s.key]: e.target.value })} className="max-w-xs" />
            {s.end && <Badge>Final</Badge>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2 border-t border-line p-3">
          <Input aria-label="New stage name" placeholder="New stage" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
          <Select aria-label="Add after" value={after} onChange={(e) => setAfter(e.target.value)}>
            {stages.filter((s) => !s.end).map((s) => (
              <option key={s.key} value={s.key}>After {labels[s.key] ?? s.key}</option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!name.trim() || save.isPending} onClick={() => save.mutate({ key: name.trim(), after })}>Add stage</Button>
          <Button disabled={!dirty || save.isPending} onClick={() => save.mutate(undefined)}>Save names</Button>
        </div>
      )}
    </Card>
  )
}

function PolicyRow({ policy, canEdit }: { policy: { id: string; rule: string; severity: string; message: string; edited?: boolean }; canEdit: boolean }) {
  const qc = useQueryClient()
  const toast = useToast()
  const save = useMutation({
    mutationFn: (severity: string) => studio.setSeverity(policy.rule, policy.id, severity),
    onSuccess: async () => {
      toast({ title: 'Policy saved in Draft', description: 'Publish to apply it.', tone: 'ok' })
      await Promise.all(['studio-rules', 'studio-status'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
    },
    onError: (e) => toast({ title: 'Could not change the policy', description: (e as Error).message, tone: 'bad' }),
  })
  return (
    <li className="flex flex-wrap items-center gap-2 p-3">
      <span className="min-w-0 flex-1 text-sm text-ink">{policy.message}{policy.edited && <Badge className="ml-2">Changed</Badge>}</span>
      <Select aria-label={`How strict: ${policy.message}`} value={policy.severity} disabled={!canEdit || save.isPending} onChange={(e) => save.mutate(e.target.value)}>
        {SEVERITIES.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </Select>
    </li>
  )
}
