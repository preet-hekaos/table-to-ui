import { useState } from 'react'
import { ApiError } from '@/api/client'
import { ai } from '@/api/endpoints'
import type { TransformRule } from '@/api/types'
import { Button } from '@/design-system'

type Proposal = { rules: TransformRule[]; explanation: string; samples: { input: string; output: unknown }[] }

const show = (v: unknown) => (v === null || v === '' ? '(empty)' : String(v))

/**
 * "Or say it in words": the AI proposes rules, the server has already checked them and run the examples,
 * and the builder decides. Nothing is added until Use as rule is pressed, and nothing is saved until Done.
 */
export function WordsPanel({ aiOn, label, type, describe, onUse }: { aiOn: boolean; label: string; type: string; describe: (r: TransformRule) => string; onUse: (rules: TransformRule[]) => void }) {
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const make = async () => {
    setBusy(true)
    setProblem(null)
    setProposal(null)
    try {
      setProposal(await ai.transform(words, label, type))
    } catch (e) {
      setProblem(e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Or say it in words" className="rounded-xl border border-violet-200 bg-violet-50 p-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-violet-800">
        Or say it in words <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] normal-case">New</span>
      </p>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Describe what should happen"
          placeholder="For example: if it says two months, save 60"
          value={words}
          disabled={!aiOn || busy}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && words.trim()) { e.preventDefault(); void make() } }}
          className="h-9 min-w-0 flex-1 rounded-md border border-violet-200 bg-surface px-2 text-sm disabled:opacity-60"
        />
        <Button size="sm" variant="primary" className="bg-violet-700 hover:bg-violet-800" disabled={!aiOn || !words.trim()} loading={busy} onClick={make}>
          Make a rule
        </Button>
      </div>
      {!aiOn && <p className="mt-2 text-xs text-violet-900">AI is off for this workspace, so this panel is disabled. An admin can turn it on in Settings › AI. The rules above still work.</p>}
      {problem && <p role="alert" className="mt-2 text-xs text-bad-ink">{problem}</p>}
      {proposal && (
        <div className="mt-3 rounded-lg border border-violet-200 bg-surface p-3" data-testid="words-proposal">
          <ul className="flex flex-col gap-1 text-sm" aria-label="Suggestion">
            {proposal.rules.map((r, i) => (
              <li key={i}><code className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent-ink">{describe(r)}</code></li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-body">{proposal.explanation}</p>
          {proposal.samples.length > 0 && (
            <ul className="mt-2 divide-y divide-line text-sm" aria-label="Examples">
              {proposal.samples.map((s, i) => (
                <li key={i} className="flex items-center gap-2 py-1.5 font-mono text-xs"><span>{show(s.input)}</span><span aria-hidden>→</span><span>{show(s.output)}</span></li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => { onUse(proposal.rules); setProposal(null); setWords('') }}>Use as rule</Button>
            <span className="text-xs text-muted">A suggestion only. Nothing is added until you press Use as rule, and nothing is saved until Done.</span>
          </div>
        </div>
      )}
    </section>
  )
}
