import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { auth } from '@/api/endpoints'
import { Button, Field, Input } from '@/design-system'
import { AuthLayout } from './AuthLayout'
import { applyServerErrors } from './forms'

/** Second step of sign-in: the 6-digit code from the authenticator app. */
export function MfaVerify() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await auth.verifyMfa(code)
      await qc.invalidateQueries()
      await navigate({ to: '/' })
    } catch (err) {
      setError(applyServerErrors(err, () => undefined, []))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Enter your code" subtitle="Open your authenticator app and type the 6-digit code.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="6-digit code" required error={error ?? undefined}>
          <Input inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={busy}>
          Verify
        </Button>
      </form>
    </AuthLayout>
  )
}
