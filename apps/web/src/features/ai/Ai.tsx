import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Copy, Sparkles, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ApiError } from '@/api/client'
import { ai } from '@/api/endpoints'
import { Badge, Button, Dialog, DialogContent, Field, Input } from '@/design-system'

/** Whether AI is on for the signed-in person, and for a given table. When it is off nothing here renders. */
export function useAi() {
  return useQuery({ queryKey: ['ai', 'settings'], queryFn: ai.settings, staleTime: 60_000, retry: false })
}
export function useAiFor(table?: string): boolean {
  const q = useAi()
  return !!q.data?.enabled && q.data.available && (!table || q.data.tables.includes(table))
}

export const aiMessage = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'The AI could not help just now.')

/** A suggestion from the AI. It is always labelled, and it never saves anything by itself. */
export function AiNote({ children, onClose, label = 'AI suggestion' }: { children: ReactNode; onClose?: () => void; label?: string }) {
  return (
    <section aria-label={label} className="rounded-lg border border-accent/40 bg-surface p-3 text-sm text-body" data-testid="ai-note">
      <div className="mb-1 flex items-center gap-2">
        <Badge tone="accent"><Sparkles className="mr-1 inline size-3" aria-hidden />{label}</Badge>
        <span className="text-xs text-muted">Check it before you use it.</span>
        {onClose && (
          <button type="button" aria-label="Dismiss" onClick={onClose} className="ml-auto rounded p-1 text-muted hover:bg-soft"><X className="size-4" aria-hidden /></button>
        )}
      </div>
      {children}
    </section>
  )
}

export function AiError({ error }: { error: unknown }) {
  return <p role="alert" className="text-sm text-bad-ink">{aiMessage(error)}</p>
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <Button type="button" size="sm" variant="secondary" onClick={() => { void navigator.clipboard?.writeText(text); setDone(true) }}>
      {done ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />} {done ? 'Copied' : 'Copy'}
    </Button>
  )
}

/** "Summarise" on a record: a short summary built from the fields this person can see. */
export function SummaryButton({ table, id }: { table: string; id: string }) {
  const on = useAiFor(table)
  const run = useMutation({ mutationFn: () => ai.summary(table, id) })
  if (!on) return null
  return (
    <>
      <Button type="button" size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
        <Sparkles className="size-4" aria-hidden /> Summarise
      </Button>
      {(run.data || run.error) && (
        <div className="basis-full" data-testid="ai-summary">
          {run.error ? <AiError error={run.error} /> : (
            <AiNote onClose={() => run.reset()}>
              <p>{run.data!.text}</p>
              <p className="mt-1 text-xs text-muted">Built from: {run.data!.used.join(', ')}.</p>
            </AiNote>
          )}
        </div>
      )}
    </>
  )
}

/** "Draft message": a first draft to edit. Nothing is sent from here. */
export function DraftButton({ table, id }: { table: string; id: string }) {
  const on = useAiFor(table)
  const [open, setOpen] = useState(false)
  const [intent, setIntent] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const run = useMutation({ mutationFn: () => ai.draft(table, id, intent), onSuccess: (d) => { setSubject(d.subject); setBody(d.body) } })
  if (!on) return null
  return (
    <>
      <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>Draft message</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Draft a message" description="The AI writes a first draft. You edit it and send it yourself; nothing is sent from here.">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (intent.trim()) run.mutate() }}>
            <Field label="What is the message for?" hint="For example: tell them about a Pune role and ask when they are free.">
              <Input value={intent} maxLength={300} onChange={(e) => setIntent(e.target.value)} />
            </Field>
            <Button type="submit" variant="primary" loading={run.isPending} disabled={!intent.trim()}>{run.data ? 'Write another draft' : 'Write a draft'}</Button>
          </form>
          {run.error && <AiError error={run.error} />}
          {run.data && (
            <div className="mt-3 flex flex-col gap-3" data-testid="ai-draft">
              <AiNote label="AI draft">
                <div className="flex flex-col gap-2">
                  <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
                  <Field label="Message">
                    <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="w-full rounded-md border border-line bg-surface p-2 text-sm text-ink" />
                  </Field>
                  <div className="flex gap-2"><CopyButton text={`${subject}\n\n${body}`} /></div>
                </div>
              </AiNote>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Why this score": words for a score the rules already computed. */
export function ExplainMatch({ screen, sourceId, targetId, table }: { screen: string; sourceId: string; targetId: string; table: string }) {
  const on = useAiFor(table)
  const run = useMutation({ mutationFn: () => ai.explainMatch(screen, sourceId, targetId) })
  if (!on) return null
  return (
    <div className="mt-2">
      {!run.data && <Button type="button" size="sm" variant="ghost" loading={run.isPending} onClick={() => run.mutate()}><Sparkles className="size-4" aria-hidden /> Explain this score</Button>}
      {run.error && <AiError error={run.error} />}
      {run.data && <AiNote label="AI explanation" onClose={() => run.reset()}><p>{run.data.text}</p></AiNote>}
    </div>
  )
}

/** "Explain this number": what a measure shows, from its own figures only. */
export function ExplainNumber({ measure, table, range }: { measure: string; table: string; range?: string }) {
  const on = useAiFor(table)
  const run = useMutation({ mutationFn: () => ai.explainNumber(measure, range) })
  if (!on) return null
  return (
    <div>
      {!run.data && <Button type="button" size="sm" variant="ghost" loading={run.isPending} onClick={() => run.mutate()}><Sparkles className="size-4" aria-hidden /> Explain</Button>}
      {run.error && <AiError error={run.error} />}
      {run.data && <AiNote label="AI explanation" onClose={() => run.reset()}><p>{run.data.text}</p></AiNote>}
    </div>
  )
}

/** "Ask in words": a sentence becomes the filters the list already understands. The person can change them. */
export function AskInWords({ table, onApply }: { table: string; onApply: (filters: Record<string, string>, q: string) => void }) {
  const on = useAiFor(table)
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const run = useMutation({
    mutationFn: () => ai.ask(table, question),
    onSuccess: (r) => {
      onApply(r.filters, r.q)
      const n = Object.keys(r.filters).length
      setNote(n || r.q ? `Applied ${n} filter${n === 1 ? '' : 's'}${r.q ? ` and the words “${r.q}”` : ''}. Change or clear them below if they are not what you meant.` : 'I could not turn that into filters. Try other words, or use the filters.')
    },
  })
  if (!on) return null
  if (!open) return <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}><Sparkles className="size-4" aria-hidden /> Ask in words</Button>
  return (
    <div className="flex basis-full flex-col gap-2" data-testid="ask-in-words">
      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) run.mutate() }}>
        <Field label="Ask in words" hint="For example: Java developers in Pune who are active">
          <Input value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" loading={run.isPending} disabled={!question.trim()}>Find</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
      </form>
      {run.error && <AiError error={run.error} />}
      {note && !run.error && <AiNote label="AI chose these filters"><p>{note}</p></AiNote>}
    </div>
  )
}
