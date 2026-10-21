import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SetupChat, describeStep } from './SetupChat'

const state = vi.fn()
const say = vi.fn()
const apply = vi.fn()
vi.mock('@/api/endpoints', () => ({
  ai: {
    setupState: () => state(),
    setupSay: (m: string) => say(m),
    setupApply: (id: string, steps: number[]) => apply(id, steps),
    setupUndo: vi.fn(),
    setupDiscard: vi.fn(),
  },
}))
vi.mock('@/design-system', async (orig) => ({ ...(await orig<object>()), useToast: () => vi.fn() }))

const plan = {
  id: 'p1', request: 'track projects', reply: 'ok', status: 'proposed', created_at: '', applied_at: null, undone_at: null,
  steps: [
    { op: 'table.add', args: { label: 'Project' }, why: 'a place', ok: true },
    { op: 'field.change', args: { table: 'candidate', field: 'email' }, why: '', ok: false, error: 'cannot be changed' },
  ],
}
const base = { messages: [], open_plan: null, undoable: null, enabled: true, available: true, can_apply: true }

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}><SetupChat /></QueryClientProvider>)
}
afterEach(() => vi.clearAllMocks())

describe('SetupChat', () => {
  it('says what a step does in plain words', () => {
    expect(describeStep({ op: 'nav.add', args: { label: 'Projects' } })).toBe('Add “Projects” to the menu')
  })
  it('explains when AI is off', async () => {
    state.mockResolvedValue({ ...base, enabled: false })
    setup()
    expect(await screen.findByText('AI is switched off')).toBeInTheDocument()
  })
  it('ticks working steps, locks failing ones and applies only what is ticked', async () => {
    state.mockResolvedValue({ ...base, open_plan: plan })
    apply.mockResolvedValue({ ...plan, status: 'applied' })
    setup()
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).toBeDisabled()
    expect(screen.getByText(/Will not work: cannot be changed/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Add 1 step to the Draft/ }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith('p1', [0]))
  })
  it('sends the typed message', async () => {
    state.mockResolvedValue(base)
    say.mockResolvedValue({ reply: 'x', plan: null })
    setup()
    await userEvent.type(await screen.findByLabelText('What should change?'), 'track suppliers')
    await userEvent.click(screen.getByRole('button', { name: 'Make a plan' }))
    await waitFor(() => expect(say).toHaveBeenCalledWith('track suppliers'))
  })
})
