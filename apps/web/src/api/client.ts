import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './schema'
import { tokens } from './session'

export interface FieldError {
  field: string
  code: string
  message: string
}

/** An RFC 9457 problem document from the API. */
export class ApiError extends Error {
  status: number
  type: string
  requestId?: string
  errors: FieldError[]
  body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body.detail ?? body.title ?? 'Request failed'))
    this.status = status
    this.body = body
    this.type = String(body.type ?? '')
    this.requestId = body.request_id as string | undefined
    this.errors = (body.errors as FieldError[] | undefined) ?? []
  }
  is(slug: string) {
    return this.type.endsWith(`/${slug}`)
  }
}

const auth: Middleware = {
  onRequest({ request }) {
    const ops = new URL(request.url).pathname.startsWith('/v1/ops')
    const token = ops ? tokens.getOps() : tokens.get()
    if (token && !request.headers.has('Authorization')) request.headers.set('Authorization', `Bearer ${token}`)
    return request
  },
}

export const api = createClient<paths>({ baseUrl: import.meta.env.VITE_API_URL ?? '' })
api.use(auth)

/** Unwrap an openapi-fetch result, turning problem documents into ApiError. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p
  if (!response.ok) {
    throw new ApiError(response.status, (error as Record<string, unknown>) ?? { title: response.statusText })
  }
  return data as T
}
