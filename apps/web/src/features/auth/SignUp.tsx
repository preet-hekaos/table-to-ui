import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { auth } from '@/api/endpoints'
import { tokens } from '@/api/session'
import { Button, Field, Input } from '@/design-system'
import { AuthLayout } from './AuthLayout'
import { applyServerErrors } from './forms'

const schema = z.object({
  agency_name: z.string().trim().min(1, 'Enter your agency name'),
  full_name: z.string().trim().min(1, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(12, 'Use at least 12 characters'),
})
type Values = z.infer<typeof schema>

export function SignUp() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(schema) })
  const { errors, isSubmitting } = formState

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const r = await auth.signUp(values)
      tokens.set(r.token)
      await qc.invalidateQueries()
      await navigate({ to: '/' })
    } catch (e) {
      setFormError(applyServerErrors(e, setError, ['agency_name', 'full_name', 'email', 'password']))
    }
  })

  return (
    <AuthLayout
      title="Create your agency workspace"
      subtitle="Your agency gets its own private workspace."
      footer={
        <>
          Already have a workspace? <Link to="/sign-in" className="font-semibold text-accent-ink underline">Sign in</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Agency name" required error={errors.agency_name?.message}>
          <Input autoComplete="organization" {...register('agency_name')} />
        </Field>
        <Field label="Your name" required error={errors.full_name?.message}>
          <Input autoComplete="name" {...register('full_name')} />
        </Field>
        <Field label="Work email" required error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" required hint="At least 12 characters." error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        {formError && (
          <p role="alert" className="rounded-md bg-bad-soft p-2 text-sm text-bad-ink">
            {formError} <button type="button" className="font-semibold underline" onClick={() => void onSubmit()}>Retry</button>
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={isSubmitting}>
          Create workspace
        </Button>
      </form>
    </AuthLayout>
  )
}
