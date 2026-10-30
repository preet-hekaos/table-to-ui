import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { auth } from '@/api/endpoints'
import { Button, Card, CardTitle, Field, Input, useToast } from '@/design-system'
import { meKey, useMe } from './useMe'

/** Turn on two-step sign-in for the signed-in user. */
export function MfaSetup() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Security</h1>
      <MfaCard />
    </div>
  )
}

function MfaCard() {
  const me = useMe()
  const qc = useQueryClient()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>()
  const enrol = useMutation({ mutationFn: auth.enrolMfa })
  const confirm = useMutation({
    mutationFn: () => auth.confirmMfa(code),
    onSuccess: async () => {
      toast({ title: 'Two-step sign-in is on', tone: 'ok' })
      await qc.invalidateQueries({ queryKey: meKey })
    },
    onError: (e) => setError(e.message),
  })

  if (me.data?.mfa_enabled) {
    return (
      <Card className="max-w-lg">
        <CardTitle>Two-step sign-in</CardTitle>
        <p className="text-sm">Two-step sign-in is on for your account.</p>
      </Card>
    )
  }
  return (
    <Card className="max-w-lg">
      <CardTitle>Turn on two-step sign-in</CardTitle>
      {!enrol.data ? (
        <Button variant="primary" onClick={() => enrol.mutate()} loading={enrol.isPending}>
          Start setup
        </Button>
      ) : (
        <div className="flex flex-col gap-3 text-sm">
          <p>Add this key to your authenticator app (Google Authenticator, Microsoft Authenticator, 1Password), then enter the code it shows.</p>
          <p className="rounded-md bg-soft p-2 font-mono break-all" data-testid="mfa-secret">
            {enrol.data.secret}
          </p>
          <Field label="6-digit code" error={error}>
            <Input inputMode="numeric" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button variant="primary" onClick={() => confirm.mutate()} loading={confirm.isPending}>
            Confirm
          </Button>
        </div>
      )}
    </Card>
  )
}
