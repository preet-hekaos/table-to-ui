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

const schema = z.object({ email: z.string().trim().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') })
type Values = z.infer<typeof schema>

export function SignIn() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [formError, setFormError] = useState<string | null>(null)
  const { register, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(schema) })

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      const r = await auth.signIn(values)
      tokens.set(r.token)
      await qc.invalidateQueries()
      await navigate({ to: r.mfa_required ? '/mfa' : '/' })
    } catch (e) {
      setFormError(applyServerErrors(e, setError, []))
    }
  })

  return (
    <AuthLayout
      title="Sign in"
      footer={
        <>
          New here? <Link to="/signup" className="font-semibold text-accent-ink underline">Create an agency workspace</Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Email" required error={formState.errors.email?.message}>
          <Input type="email" autoComplete="username" {...register('email')} />
        </Field>
        <Field label="Password" required error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        {formError && (
          <p role="alert" className="rounded-md bg-bad-soft p-2 text-sm text-bad-ink">
            {formError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" loading={formState.isSubmitting}>
          Continue
        </Button>
      </form>
    </AuthLayout>
  )
}
