import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import { ErrorState, LoadingState, NotFound, PermissionDenied, useToast } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'
import { RecordForm } from '@/patterns/RecordForm'

/** Thin 3.6: the add form, generated from the live table definition. */
export function RecordNew({ tableKey }: { tableKey: string }) {
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const me = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  if (def.error instanceof ApiError && def.error.status === 404) return <NotFound what="table" />
  if (def.error) return <ErrorState requestId={(def.error as ApiError).requestId} onRetry={() => void def.refetch()} />
  if (!def.data || !me.data) return <LoadingState />
  if (!can(me.data.permissions, `record.${tableKey}.create`)) return <PermissionDenied />
  const table = def.data.table
  return (
    <div className="flex flex-col gap-4">
      <Link to="/records/$table" params={{ table: tableKey }} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {table.plural_label}
      </Link>
      <h1 className="text-xl font-bold text-ink">Add {table.label.toLowerCase()}</h1>
      <RecordForm
        table={table}
        onCreated={(id) => {
          void qc.invalidateQueries({ queryKey: ['records', tableKey] })
          void qc.invalidateQueries({ queryKey: ['measures'] })
          toast({ title: `${table.label} added`, tone: 'ok' })
          void navigate({ to: '/records/$table/$id', params: { table: tableKey, id } })
        }}
      />
    </div>
  )
}
