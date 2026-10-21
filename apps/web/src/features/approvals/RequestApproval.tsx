import { useState } from 'react'
import { ApiError } from '@/api/client'
import { approvals, type ApprovalRequestInput } from '@/api/endpoints'
import type { RuleOutcome } from '@/api/types'
import { Button, Dialog, DialogContent, Field, useToast } from '@/design-system'

/** A change a rule sent for a manager's decision: say why, and it is held until someone decides. */
export function RequestApproval({
  open,
  onOpenChange,
  request,
  checks,
  onSent,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  request: ApprovalRequestInput
  checks: RuleOutcome[]
  onSent: () => void
}) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send() {
    setBusy(true)
    setError(null)
    try {
      await approvals.request({ ...request, note })
      toast({ title: 'Sent for approval. Nothing is saved until a manager approves it.', tone: 'ok' })
      onOpenChange(false)
      onSent()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Nothing was sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="This needs a manager's approval" description="A rule holds this change until someone else approves it.">
        <ul className="mb-3 flex flex-col gap-1 text-sm text-body">
          {checks.map((c) => (
            <li key={c.check}>
              <span className="font-semibold">{c.rule}</span>: {c.message}
            </li>
          ))}
        </ul>
        <Field label="Note for the approver" hint="Why should this go ahead?">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </Field>
        {error && <p role="alert" className="mt-2 rounded-md bg-bad-soft p-2 text-sm text-bad-ink">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={() => void send()}>
            Request approval
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
