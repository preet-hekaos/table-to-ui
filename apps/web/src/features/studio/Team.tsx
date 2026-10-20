import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { auth } from '@/api/endpoints'
import { Button, Card, CardTitle, Field, Input, PermissionDenied, Select, useToast } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'

const ROLES = [
  ['recruiter', 'Recruiter'],
  ['manager', 'Manager'],
  ['sourcer', 'Sourcer'],
  ['coordinator', 'Coordinator'],
  ['finance', 'Finance'],
  ['viewer', 'Viewer'],
] as const

/** Screen 1.3, sending side: invite a teammate by email. */
export function Team() {
  const me = useMe()
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<string>('recruiter')
  const [devLink, setDevLink] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const invite = useMutation({
    mutationFn: () => auth.invite({ email, role }),
    onSuccess: (r) => {
      toast({ title: `Invitation sent to ${email}`, tone: 'ok' })
      setDevLink((r as { dev_accept_link?: string }).dev_accept_link ?? null)
      setEmail('')
      setError(undefined)
    },
    onError: (e) => setError(e.message),
  })
  if (!me.data) return null
  if (!can(me.data.permissions, 'invitation.send')) return <PermissionDenied what="Only agency admins can invite teammates." />

  function submit(e: FormEvent) {
    e.preventDefault()
    invite.mutate()
  }
  return (
    <div className="flex max-w-lg flex-col gap-4">
      <h1 className="text-xl font-bold text-ink">Team</h1>
      <Card>
        <CardTitle>Invite a teammate</CardTitle>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Email" required error={error}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role" required>
            <Select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" loading={invite.isPending}>
            Send invitation
          </Button>
        </form>
        {devLink && (
          <p className="mt-4 rounded-md bg-soft p-2 text-xs break-all" data-testid="dev-accept-link">
            <b>Local development only:</b> <a className="underline" href={devLink}>{devLink}</a>
          </p>
        )}
      </Card>
    </div>
  )
}
