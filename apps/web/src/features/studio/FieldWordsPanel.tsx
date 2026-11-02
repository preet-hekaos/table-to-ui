import { useState } from 'react'
import { ApiError } from '@/api/client'
import { ai } from '@/api/endpoints'
import { Button } from '@/design-system'
import { TYPE_LABELS } from './typeLabels'

type Proposal = Awaited<ReturnType<typeof ai.field>>

/**
 * "Describe it in words" for a new field: the AI proposes label, type, length, required and choices; the server has
 * already checked them against the real types. Nothing changes in the form until Use these settings is pressed.
 */
export function FieldWordsPanel({ aiOn, onUse }: { aiOn: boolean; onUse: (p: Proposal) => void }) {
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const suggest = async () => {
    setBusy(true)
    setProblem(null)
    setProposal(null)
    try {
      setProposal(await ai.field(words))
    } catch (e) {
      setProblem(e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Describe it in words" className="rounded-xl border border-violet-200 bg-violet-50 p-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-violet-800">
        Describe it in words <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] normal-case">New</span>
      </p>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Describe the field"
          placeholder="For example: PAN number, required"
          value={words}
          disabled={!aiOn || busy}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && words.trim()) { e.preventDefault(); void suggest() } }}
          className="h-9 min-w-0 flex-1 rounded-md border border-violet-200 bg-surface px-2 text-sm disabled:opacity-60"
        />
        <Button size="sm" variant="primary" className="bg-violet-700 hover:bg-violet-800" disabled={!aiOn || !words.trim()} loading={busy} onClick={suggest}>
          Suggest a field
        </Button>
      </div>
      {!aiOn && <p className="mt-2 text-xs text-violet-900">AI is off for this workspace, so this is disabled. An admin can turn it on in Settings › AI. You can still fill the form by hand.</p>}
      {problem && <p role="alert" className="mt-2 text-xs text-bad-ink">{problem}</p>}
      {proposal && (
        <div className="mt-3 rounded-lg border border-violet-200 bg-surface p-3" data-testid="field-proposal">
          <p className="text-sm font-semibold text-ink">{proposal.label}</p>
          <p className="text-xs text-body">
            {proposal.type_name ?? TYPE_LABELS[proposal.type]}
            {proposal.max_length ? `, up to ${proposal.max_length} characters` : ''}
            {proposal.required ? ', required' : ''}
            {proposal.options.length ? `, choices: ${proposal.options.join(', ')}` : ''}
          </p>
          <p className="mt-1 text-xs text-body">{proposal.explanation}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => { onUse(proposal); setProposal(null); setWords('') }}>Use these settings</Button>
            <span className="text-xs text-muted">A suggestion only. Nothing is added until you press Add field.</span>
          </div>
        </div>
      )}
    </section>
  )
}
