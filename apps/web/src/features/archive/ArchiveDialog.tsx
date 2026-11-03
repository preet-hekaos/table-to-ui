import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, X } from 'lucide-react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { archive, type ArchiveKind } from '@/api/endpoints'
import { Button, Dialog, Input, useToast } from '@/design-system'

const KIND_WORD: Record<ArchiveKind, string> = { field: 'field', link: 'link', measure: 'measure', automation: 'automation', record: 'record' }

export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** "Are you absolutely sure?" in the GitHub style: what will happen, then type the name to confirm. */
export function ArchiveDialog({
  kind,
  itemKey,
  table,
  label,
  tableLabel,
  onClose,
  onArchived,
}: {
  kind: Exclude<ArchiveKind, 'record'>
  itemKey: string
  table?: string
  label: string
  tableLabel?: string
  onClose: () => void
  onArchived: () => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [typed, setTyped] = useState('')
  const impact = useQuery({ queryKey: ['archive-impact', kind, table, itemKey], queryFn: () => archive.impact(kind, itemKey, table), retry: false })
  const word = KIND_WORD[kind]
  const phrase = tableLabel && (kind === 'field' || kind === 'link') ? `${tableLabel}/${label}` : label
  const info = impact.data
  const blocked = (info?.blockers.length ?? 0) > 0
  const go = useMutation({
    mutationFn: () => archive.add(kind, itemKey, table),
    onSuccess: async (item) => {
      await qc.invalidateQueries()
      toast({
        title: `${label} archived`,
        description: item.delete_after ? `Deletes for good on ${fmtDate(item.delete_after)}. Restore it any time before.` : 'It stays in the archive until you delete it.',
        tone: 'ok',
        action: {
          label: 'Undo',
          onClick: () => void archive.restore([item.id]).then(() => qc.invalidateQueries()),
        },
      })
      onArchived()
    },
    onError: (e) => toast({ title: 'Could not archive', description: (e as Error).message, tone: 'bad' }),
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[60] bg-ink/40" />
        <RadixDialog.Content
          data-testid="archive-dialog"
          className="fixed top-1/2 left-1/2 z-[70] flex max-h-[92vh] w-[min(37.5rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-surface shadow-pop focus:outline-none"
        >
          <div className="flex items-center gap-3 border-b border-line px-6 py-4">
            <RadixDialog.Title className="flex-1 text-lg font-bold text-ink">Are you absolutely sure?</RadixDialog.Title>
            <RadixDialog.Close aria-label="Close" className="rounded-md p-1.5 text-muted hover:bg-soft">
              <X className="size-4" aria-hidden />
            </RadixDialog.Close>
          </div>
          <div className="flex items-start gap-2.5 border-b border-warn/40 bg-warn-soft px-6 py-3 text-sm text-warn-ink">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <RadixDialog.Description>
              <b>Heads up:</b> archiving a {word} changes your forms and screens.
              {info?.delete_on ? <> You can restore it until it is deleted for good on <b>{fmtDate(info.delete_on)}</b>.</> : <> It stays in the archive until you delete it.</>}
            </RadixDialog.Description>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {impact.isError && <p role="alert" className="text-sm text-bad-ink">{(impact.error as Error).message}</p>}
            {!info && !impact.isError && <p className="text-sm text-muted">Checking what this touches…</p>}
            {info && (
              <>
                <p className="mb-2 text-sm text-ink">
                  You are about to archive the {word} <b>{label}</b>
                  {info.where ? <> on <b>{info.where}</b></> : null}. This will:
                </p>
                <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-body">
                  <li>Hide it from every form, list, filter, chart and export.</li>
                  {info.effects.map((e) => <li key={e}>{e}</li>)}
                  {info.kept > 0 && <li>Keep its <b>{info.kept}</b> saved {info.kept === 1 ? 'value' : 'values'}, so a restore brings {info.kept === 1 ? 'it' : 'them'} back.</li>}
                  <li>{info.days ? <>Delete it for good after <b>{info.days} days</b>, unless you restore it first.</> : <>Keep it until you delete it yourself.</>}</li>
                </ul>
                {blocked && (
                  <div role="alert" className="mb-4 rounded-lg border border-bad bg-bad-soft px-3 py-2 text-sm text-bad-ink" data-testid="archive-blocked">
                    <b>It cannot be archived yet:</b>
                    <ul className="mt-1 list-disc pl-5">{info.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                  </div>
                )}
                {!blocked && (
                  <>
                    <label htmlFor="archive-confirm" className="mb-1.5 block text-sm text-ink">
                      Please type <code className="rounded bg-soft px-1.5 py-0.5 font-mono text-[13px]">{phrase}</code> to confirm.
                    </label>
                    <Input id="archive-confirm" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
                  </>
                )}
              </>
            )}
          </div>
          <div className="border-t border-line px-6 py-4">
            <Button
              type="button"
              variant="danger"
              className="h-11 w-full"
              disabled={!info || blocked || typed !== phrase}
              loading={go.isPending}
              onClick={() => go.mutate()}
            >
              I understand, archive this {word}
            </Button>
            <div className="mt-2 text-center">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            </div>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </Dialog>
  )
}
