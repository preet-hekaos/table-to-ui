import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ai } from '@/api/endpoints'
import { Badge, Button, Card, CardTitle, Field, Input, LoadingState, Table, Td, Th, useToast } from '@/design-system'

/** The AI switch for this workspace: on or off, which tables it may read, and a monthly limit. */
export function AiSettings() {
  const qc = useQueryClient()
  const toast = useToast()
  const s = useQuery({ queryKey: ['ai', 'settings'], queryFn: ai.settings })
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [tables, setTables] = useState<string[] | null>(null)
  const [cap, setCap] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => ai.saveSettings({ enabled: enabled ?? undefined, tables: tables ?? undefined, monthly_token_cap: cap === null ? undefined : Number(cap) }),
    onSuccess: async () => {
      toast({ title: 'AI settings saved', tone: 'ok' })
      setEnabled(null); setTables(null); setCap(null)
      await qc.invalidateQueries({ queryKey: ['ai'] })
    },
    onError: (e) => toast({ title: (e as Error).message, tone: 'bad' }),
  })
  if (!s.data) return <LoadingState label="Loading AI settings" />
  const d = s.data
  const on = enabled ?? d.enabled
  const picked = tables ?? d.tables
  const limit = cap ?? String(d.monthly_token_cap ?? 0)
  const used = d.used_tokens ?? 0
  const pct = d.monthly_token_cap ? Math.min(100, Math.round((used / d.monthly_token_cap) * 100)) : 100
  const bad = !/^\d+$/.test(limit)
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <p className="text-sm text-body">
        AI can read a document, summarise a record, explain a score, turn a sentence into a search and draft a message. It only suggests: nothing it writes is saved or sent until a person accepts it, and scores and numbers are still worked out by the rules.
      </p>
      {!d.available && <p role="status" className="rounded-md bg-warn-soft p-3 text-sm text-warn-ink">No AI provider is set up on the server yet, so the buttons stay hidden even when this is on.</p>}
      <Card className="flex flex-col gap-4">
        <label className="flex items-center gap-3 text-sm font-semibold text-ink">
          <input type="checkbox" checked={on} onChange={(e) => setEnabled(e.target.checked)} className="size-4" />
          Turn AI on for this workspace
          {d.provider && <Badge>{d.provider}</Badge>}
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-semibold text-ink">Tables AI may read</legend>
          <p className="text-xs text-muted">Only fields a person can already see are used, and email addresses and phone numbers are removed unless the feature needs them.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {(d.all_tables ?? []).map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm text-body">
                <input type="checkbox" checked={picked.includes(t)} onChange={(e) => setTables(e.target.checked ? [...picked, t] : picked.filter((x) => x !== t))} className="size-4" />
                {t.replace(/_/g, ' ')}
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Monthly limit (tokens)" hint="Once it is reached the AI buttons say so and the rest of the app carries on." error={bad ? 'Enter a whole number.' : undefined}>
          <Input inputMode="numeric" value={limit} onChange={(e) => setCap(e.target.value)} />
        </Field>
        <div>
          <div className="flex justify-between text-xs text-muted"><span>Used this month</span><span>{used.toLocaleString()} of {(d.monthly_token_cap ?? 0).toLocaleString()}</span></div>
          <div className="mt-1 h-2 rounded bg-soft" role="img" aria-label={`${pct} percent of this month's limit used`}><div className="h-2 rounded bg-accent" style={{ width: `${pct}%` }} /></div>
        </div>
        <Button className="w-fit" variant="primary" loading={save.isPending} disabled={bad || (enabled === null && tables === null && cap === null)} onClick={() => save.mutate()}>Save AI settings</Button>
      </Card>
      <Card className="p-0">
        <div className="p-4"><CardTitle>Recent AI use</CardTitle><p className="text-xs text-muted">Every call is logged: who, which feature, which wording, how many tokens. The text sent is not kept.</p></div>
        <Table aria-label="Recent AI use">
          <thead><tr><Th>When</Th><Th>Who</Th><Th>Feature</Th><Th>Result</Th><Th>Tokens</Th></tr></thead>
          <tbody>
            {(d.recent ?? []).length === 0 && <tr><Td colSpan={5}>Nothing yet.</Td></tr>}
            {(d.recent ?? []).map((r, i) => (
              <tr key={i}>
                <Td>{new Date(r.at).toLocaleString('en-IN')}</Td>
                <Td>{r.by ?? '—'}</Td>
                <Td title={r.prompt_version}>{r.feature.replace(/_/g, ' ')}</Td>
                <Td><Badge tone={r.outcome === 'ok' || r.outcome === 'cached' ? 'ok' : 'warn'}>{r.outcome.replace(/_/g, ' ')}</Badge></Td>
                <Td>{r.tokens}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  )
}
