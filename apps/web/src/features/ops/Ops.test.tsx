import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceConsole } from './Ops'

const list = vi.fn()
const suspend = vi.fn()
vi.mock('@/api/endpoints', () => ({
  ops: {
    workspaces: () => list(),
    packs: () => Promise.resolve([]),
    suspend: (id: string, reason: string) => suspend(id, reason),
    resume: vi.fn(),
    cancelDelete: vi.fn(),
  },
}))
vi.mock('@/api/session', () => ({ tokens: { getOps: () => 'x', setOps: vi.fn() } }))
vi.mock('@/design-system', async (orig) => ({ ...(await orig<object>()), useToast: () => vi.fn() }))

const ws = (over: object) => ({
  id: 'w1', name: 'Acme', pack: 'recruitment', status: 'active', reason: null, delete_after: null, created_at: '2026-01-01T00:00:00Z',
  owner_email: 'o@acme.test', people: 2, records: 40, storage_mb: 1.5, last_activity: null,
  limits: { max_people: 5, max_records: null, max_storage_mb: null, ai_monthly_tokens: null }, ai_tokens_this_month: 0, ...over,
})

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><WorkspaceConsole /></QueryClientProvider>)
}
afterEach(() => vi.clearAllMocks())

describe('WorkspaceConsole', () => {
  it('shows counts and offers only the actions that fit each status', async () => {
    list.mockResolvedValue([ws({}), ws({ id: 'w2', name: 'Beta', status: 'suspended', reason: 'Unpaid' }), ws({ id: 'w3', name: 'Gone', status: 'scheduled_deletion', delete_after: '2026-02-01T00:00:00Z' })])
    setup()
    const table = await screen.findByRole('table', { name: 'Workspaces' })
    expect(within(table).getAllByText('2 / 5')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Suspend Acme' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Acme' })).toBeNull() // delete needs a suspended workspace first
    expect(screen.getByRole('button', { name: 'Delete Beta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume Beta' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel deletion of Gone' })).toBeInTheDocument()
  })

  it('sends the reason when suspending', async () => {
    list.mockResolvedValue([ws({})])
    suspend.mockResolvedValue({})
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Suspend Acme' }))
    await userEvent.type(await screen.findByLabelText(/Reason/), 'Unpaid invoice')
    await userEvent.click(screen.getByRole('button', { name: 'Suspend workspace' }))
    expect(suspend).toHaveBeenCalledWith('w1', 'Unpaid invoice')
  })
})
