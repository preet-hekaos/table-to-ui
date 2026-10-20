import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { ApiError } from '@/api/client'
import { app } from '@/api/endpoints'
import { ErrorState, LoadingState, NotFound, PermissionDenied, useToast } from '@/design-system'
import { can, useMe } from '@/features/auth/useMe'
import { RecordForm } from '@/patterns/RecordForm'

/** The edit form for one record, generated from the live table definition. */
export function RecordEdit({ tableKey, id }: { tableKey: string; id: string }) {
  const def = useQuery({ queryKey: ['table', tableKey], queryFn: () => app.table(tableKey), retry: false })
  const rec = useQuery({ queryKey: ['record', tableKey, id], queryFn: () => app.get(tableKey, id), retry: false })
  const me = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const err = def.error ?? rec.error
  if (err instanceof ApiError && err.status === 404) return <NotFound what="record" />
  if (err) return <ErrorState requestId={(err as ApiError).requestId} onRetry={() => void rec.refetch()} />
  if (!def.data || !rec.data || !me.data) return <LoadingState />
  if (!can(me.data.permissions, `record.${tableKey}.update`)) return <PermissionDenied />
  const table = def.data.table
  return (
    <div className="flex flex-col gap-4">
      <Link to="/records/$table/$id" params={{ table: tableKey, id }} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Back to {table.label.toLowerCase()}
      </Link>
      <h1 className="text-xl font-bold text-ink">Edit {table.label.toLowerCase()}</h1>
      <RecordForm
        table={table}
        initial={rec.data}
        onCreated={() => {
          void qc.invalidateQueries({ queryKey: ['records', tableKey] })
          void qc.invalidateQueries({ queryKey: ['record', tableKey, id] })
          void qc.invalidateQueries({ queryKey: ['history', tableKey, id] })
          void qc.invalidateQueries({ queryKey: ['measures'] })
          toast({ title: `${table.label} saved`, tone: 'ok' })
          void navigate({ to: '/records/$table/$id', params: { table: tableKey, id } })
        }}
      />
    </div>
  )
}
