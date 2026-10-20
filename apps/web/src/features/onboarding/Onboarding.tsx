import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { ApiError } from '@/api/client'
import { workspace } from '@/api/endpoints'
import { Button, Card, ErrorState, LoadingState } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'

export const onboardingKey = ['onboarding'] as const

/** First sign-in: choose what to start from. A pack installs tables, roles and screens; Blank starts empty. */
export function Onboarding() {
  const me = useMe()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [chosen, setChosen] = useState<string | null>(null)
  const state = useQuery({ queryKey: onboardingKey, queryFn: workspace.onboarding })
  const install = useMutation({
    mutationFn: (id: string) => workspace.choosePack(id),
    onSuccess: async () => {
      await qc.invalidateQueries()
      await navigate({ to: '/' })
    },
  })

  if (state.isLoading) return <LoadingState label="Loading your options" />
  if (state.error) return <ErrorState requestId={(state.error as ApiError).requestId} onRetry={() => void state.refetch()} />
  const canChoose = can(me.data?.permissions, 'workspace.manage')

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 py-4">
      <div>
        <h1 className="text-xl font-bold text-ink">Set up {state.data?.workspace}</h1>
        <p className="text-sm text-muted">
          Choose a starting point. Everything it creates can be changed later from the Studio.
        </p>
      </div>
      {!canChoose && <p role="status" className="text-sm text-muted">A workspace admin needs to choose the starting point.</p>}
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Starting point">
        {state.data?.packs.map((p) => (
          <Card key={p.id}>
            <label className="flex cursor-pointer flex-col gap-1">
              <span className="flex items-center gap-2 font-semibold text-ink">
                <input type="radio" name="pack" value={p.id} checked={chosen === p.id} disabled={!canChoose} onChange={() => setChosen(p.id)} />
                {p.title}
              </span>
              <span className="text-sm text-muted">{p.description}</span>
              <span className="text-xs text-muted">Tables: {p.tables.join(', ')}</span>
              {p.roles.length > 0 && <span className="text-xs text-muted">Roles: {p.roles.join(', ')}</span>}
            </label>
          </Card>
        ))}
        <Card>
          <label className="flex cursor-pointer flex-col gap-1">
            <span className="flex items-center gap-2 font-semibold text-ink">
              <input type="radio" name="pack" value="blank" checked={chosen === 'blank'} disabled={!canChoose} onChange={() => setChosen('blank')} />
              Start blank
            </span>
            <span className="text-sm text-muted">An empty workspace. Create your own tables and screens in the Studio.</span>
          </label>
        </Card>
      </div>
      {install.error && (
        <p role="alert" className="rounded-md bg-bad-soft p-2 text-sm text-bad-ink">{(install.error as Error).message}</p>
      )}
      <div>
        <Button variant="primary" size="lg" disabled={!chosen || !canChoose} loading={install.isPending} onClick={() => chosen && install.mutate(chosen)}>
          Set up workspace
        </Button>
      </div>
    </div>
  )
}
