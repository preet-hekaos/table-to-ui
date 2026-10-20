import { ApiError, type FieldError } from '@/api/client'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

/** Show server-side field errors next to their fields; return what could not be placed. */
export function applyServerErrors<T extends FieldValues>(err: unknown, setError: UseFormSetError<T>, known: string[]): string | null {
  if (!(err instanceof ApiError)) return 'Something went wrong. Please try again.'
  let placed = false
  for (const e of err.errors as FieldError[]) {
    if (known.includes(e.field)) {
      setError(e.field as Path<T>, { message: e.message[0]?.toUpperCase() + e.message.slice(1) })
      placed = true
    }
  }
  return placed ? null : err.requestId ? `${err.message} (request id ${err.requestId})` : err.message
}
