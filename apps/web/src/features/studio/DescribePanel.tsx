import { Check, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { ApiError } from '@/api/client'
import { ai, studio } from '@/api/endpoints'
import { Button } from '@/design-system'

type Proposal = { pattern: string; explanation: string; samples: { value: string; allowed: boolean }[] }

const Verdict = ({ ok }: { ok: boolean }) =>
  ok ? (
    <span className="flex items-center gap-1 font-semibold text-ok-ink"><Check className="size-3.5" aria-hidden />Allowed</span>
  ) : (
    <span className="flex items-center gap-1 font-semibold text-bad-ink"><X className="size-3.5" aria-hidden />Not allowed</span>
  )

/**
 * "Describe it in words": the AI proposes a pattern, the server has already checked it, and the builder decides.
 * Nothing is added until Use as rule or Edit pattern is pressed, and nothing is saved until Done.
 */
export function DescribePanel({ aiOn, onUse }: { aiOn: boolean; onUse: (name: string, pattern: string, edit: boolean) => void }) {
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [own, setOwn] = useState('')
  const [ownResult, setOwnResult] = useState<boolean | null>(null)

  const shown = useRef<HTMLDivElement>(null)
  useEffect(() => {
    shown.current?.scrollIntoView({ block: 'nearest' })
  }, [proposal])
  useEffect(() => {
    if (!proposal || !own) return
    const t = setTimeout(() => {
      studio.validationPreview({ kind: 'pattern', pattern: proposal.pattern }, [own]).then(
        (r) => setOwnResult(r.results[0]?.allowed ?? null),
        () => setOwnResult(null),
      )
    }, 250)
    return () => clearTimeout(t)
  }, [own, proposal])

  const make = async () => {
    setBusy(true)
    setProblem(null)
    setProposal(null)
    setOwn('')
    setOwnResult(null)
    try {
      setProposal(await ai.pattern(words))
    } catch (e) {
      setProblem(e instanceof ApiError ? (e.errors[0]?.message ?? e.message) : (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const title = words.trim().slice(0, 40) || 'Described pattern'

  return (
    <section aria-label="Describe it in words" className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3">
      <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-violet-800">
        Describe it in words <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] normal-case">New</span>
      </p>
      <div className="mt-2 flex gap-2">
        <input
          aria-label="Describe the allowed values"
          placeholder="For example: 5 capital letters, then 4 digits, then 1 capital letter"
          value={words}
          disabled={!aiOn || busy}
          onChange={(e) => setWords(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && words.trim()) { e.preventDefault(); void make() } }}
          className="h-9 min-w-0 flex-1 rounded-md border border-violet-200 bg-surface px-2 text-sm disabled:opacity-60"
        />
        <Button size="sm" variant="primary" className="bg-violet-700 hover:bg-violet-800" disabled={!aiOn || !words.trim()} loading={busy} onClick={make}>
          Make a pattern
        </Button>
      </div>
      {!aiOn && (
        <p className="mt-2 text-xs text-violet-900">
          AI is off for this workspace, so this panel is disabled. An admin can turn it on in Settings › AI. The library and your own patterns still work.
        </p>
      )}
      {problem && <p role="alert" className="mt-2 text-xs text-bad-ink">{problem}</p>}
      {proposal && (
        <div ref={shown} className="mt-3 rounded-lg border border-violet-200 bg-surface p-3" data-testid="proposal">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent-ink">{proposal.pattern}</code>
            <span className="text-body">{proposal.explanation}</span>
          </p>
          <ul className="mt-2 divide-y divide-line text-sm" aria-label="Samples">
            {proposal.samples.map((s) => (
              <li key={`${s.allowed}-${s.value}`} className="flex items-center justify-between py-1.5">
                <span className="font-mono text-xs">{s.value}</span>
                <Verdict ok={s.allowed} />
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 py-1.5">
              <input aria-label="Try your own value" placeholder="Try your own value…" value={own} onChange={(e) => setOwn(e.target.value)} className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 font-mono text-xs hover:border-line focus:border-accent" />
              {ownResult !== null && own && <span role="status"><Verdict ok={ownResult} /></span>}
            </li>
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => { onUse(title, proposal.pattern, false); setProposal(null); setWords('') }}>Use as rule</Button>
            <Button size="sm" variant="secondary" onClick={() => { onUse(title, proposal.pattern, true); setProposal(null); setWords('') }}>Edit pattern</Button>
            <span className="text-xs text-muted">A suggestion only. Nothing is added until you press Use as rule, and nothing is saved until Done.</span>
          </div>
        </div>
      )}
    </section>
  )
}
