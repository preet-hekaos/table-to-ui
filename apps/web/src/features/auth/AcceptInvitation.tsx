import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { auth } from '@/api/endpoints'
import { tokens } from '@/api/session'
import { Button, ErrorState, Field, Input, LoadingState } from '@/design-system'
import { AuthLayout } from './AuthLayout'
import { applyServerErrors } from './forms'

const schema = z.object({ full_name: z.string().trim().min(1, 'Enter your name'), password: z.string().min(12, 'Use at least 12 characters') })
type Values = z.infer<typeof schema>

export function AcceptInvitation({ token }: { token: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const info = useQuery({ queryKey: ['invitation', token], queryFn: () => auth.invitation(token), retry: false })
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  if (info.isLoading) return <AuthLayout title="Invitation"><LoadingState /></AuthLayout>
  if (info.isError) return <AuthLayout title="Invitation"><ErrorState onRetry={() => void info.refetch()} /></AuthLayout>
  if (info.data && info.data.state !== 'valid') {
    return (
      <AuthLayout title={info.data.state === 'used' ? 'This invitation was already used' : 'This invitation has expired'} subtitle="Ask the person who invited you to send a new invitation.">
        <p className="text-sm text-muted">Invitations work once and last 7 days.</p>
      </AuthLayout>
    )
  }
  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const r = await auth.acceptInvitation(token, values)
      tokens.set(r.token)
      await qc.invalidateQueries()
      await navigate({ to: '/' })
    } catch (e) {
      setFormError(applyServerErrors(e, setError, ['full_name', 'password']))
    }
  })
  return (
    <AuthLayout title={`Join ${info.data?.tenant_name}`} subtitle={`You are joining as ${info.data?.role} with ${info.data?.email}.`}>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Your name" required error={formState.errors.full_name?.message}>
          <Input autoComplete="name" {...register('full_name')} />
        </Field>
        <Field label="Choose a password" required hint="At least 12 characters." error={formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        {formError && <p role="alert" className="rounded-md bg-bad-soft p-2 text-sm text-bad-ink">{formError}</p>}
        <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting}>
          Join workspace
        </Button>
      </form>
    </AuthLayout>
  )
}
