import * as RadixDialog from '@radix-ui/react-dialog'
import { useQuery } from '@tanstack/react-query'
import { Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { ai, studio } from '@/api/endpoints'
import type { FieldDef, StudioTable } from '@/api/types'
import { Badge, Button, StageBadge } from '@/design-system'
import type { Stage } from '@/design-system'
import { explainAsText, explainField } from './explain'
import { featuresOf } from './features'

const QUESTIONS = ['Why is it unique?', 'What if it is blank?', 'What breaks if I remove it?']

/**
 * "Explain this field": a read-only side panel, opened only on request. The facts are built from the field's own
 * settings and need no AI. When AI is on, a question box answers from the same facts. Nothing here changes data.
 */
export function ExplainPanel({
  table,
  tables,
  field,
  stage,
  canEdit,
  onClose,
  onEdit,
}: {
  table: StudioTable
  tables: StudioTable[]
  field: FieldDef
  stage?: Stage
  canEdit: boolean
  onClose: () => void
  onEdit: () => void
}) {
  const about = useQuery({ queryKey: ['field-about', table.key, field.key], queryFn: () => studio.fieldAbout(table.key, field.key), retry: false })
  const screens = useQuery({ queryKey: ['studio-screens'], queryFn: studio.screens, retry: false })
  const aiSetting = useQuery({ queryKey: ['ai', 'settings'], queryFn: ai.settings, staleTime: 60_000, retry: false })
  const aiOn = !!aiSetting.data?.enabled
  const own = screens.data?.find((x) => x.table === table.key && x.pattern === 'searchable_table')
  const e = explainField(table, tables, field, featuresOf(table), about.data ?? null, {
    listless: !!screens.data && !own,
    columns: (own?.config.columns as string[] | undefined) ?? undefined,
  })

  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const ask = async (text: string) => {
    if (!text.trim()) return
    setBusy(true)
    setProblem(null)
    setAnswer(null)
    try {
      setAnswer((await ai.fieldQuestion(table.key, field.key, text)).text)
    } catch (err) {
      setProblem(err instanceof ApiError ? (err.errors[0]?.message ?? err.message) : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(explainAsText(field.label, e))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <RadixDialog.Root open onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-ink/20" />
        <RadixDialog.Content
          data-testid="explain-panel"
          className="fixed inset-y-0 right-0 z-50 flex w-[min(28.75rem,100vw)] flex-col bg-surface shadow-pop focus:outline-none"
        >
          <div className="flex items-start gap-3 border-b border-line px-6 py-5">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-violet-800">
                <Sparkles className="size-3" aria-hidden /> Explain · read only
              </p>
              <RadixDialog.Title className="mt-0.5 truncate text-xl font-bold text-ink">{field.label}</RadixDialog.Title>
              <RadixDialog.Description className="sr-only">What {field.label} is, what happens to it, where it shows and what depends on it.</RadixDialog.Description>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge>{field.type_name ?? field.type}</Badge>
                {stage && stage !== 'live' && <StageBadge stage={stage} />}
              </div>
            </div>
            <RadixDialog.Close aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-soft">
              <X className="size-4" aria-hidden />
            </RadixDialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="border-b border-line bg-violet-50 px-6 py-4 text-[15px] text-ink" data-testid="explain-summary">{e.summary}</p>
            {e.sections.map((s) => (
              <section key={s.id} aria-label={s.title} className="border-b border-line px-6 py-4" data-testid={`explain-${s.id}`}>
                <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">{s.title}</h3>
                {s.lines.map((l, i) => (
                  <p key={i} className={`mb-1.5 text-sm ${l.muted ? 'text-muted' : 'text-ink'}`}>{l.text}</p>
                ))}
              </section>
            ))}
            <section aria-label="Ask about this field" className="px-6 py-4">
              <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">Ask about this field</h3>
              <div className="flex gap-2">
                <input
                  aria-label="Ask a question about this field"
                  placeholder="For example: what if a candidate has none?"
                  value={q}
                  disabled={!aiOn || busy}
                  maxLength={300}
                  onChange={(ev) => setQ(ev.target.value)}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' && q.trim()) { ev.preventDefault(); void ask(q) } }}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-sm disabled:bg-soft disabled:text-muted"
                />
                <Button size="sm" variant="primary" disabled={!aiOn || !q.trim()} loading={busy} onClick={() => void ask(q)}>Ask</Button>
              </div>
              {aiOn ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {QUESTIONS.map((x) => (
                    <button key={x} type="button" disabled={busy} onClick={() => { setQ(x); void ask(x) }} className="rounded-full bg-soft px-2.5 py-1 text-xs text-body hover:bg-line">{x}</button>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-body">AI is off for this workspace, so questions are off. Everything above still works. An admin can turn AI on in Settings › AI.</p>
              )}
              {problem && <p role="alert" className="mt-2 text-xs text-bad-ink">{problem}</p>}
              {answer && (
                <div className="mt-3 rounded-lg bg-violet-50 p-3" data-testid="explain-answer">
                  <p className="text-sm text-ink">{answer}</p>
                  <p className="mt-2 text-xs text-muted">AI answer from this field’s settings. Nothing was changed. Check it before you rely on it.</p>
                </div>
              )}
            </section>
          </div>

          <div className="flex items-center gap-2 border-t border-line px-6 py-3.5">
            <Button size="sm" variant="secondary" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy as text'}</Button>
            {canEdit && <Button size="sm" variant="secondary" onClick={() => { onClose(); onEdit() }}>Edit field</Button>}
            <span className="ml-auto text-xs text-muted">Nothing here changes data</span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
