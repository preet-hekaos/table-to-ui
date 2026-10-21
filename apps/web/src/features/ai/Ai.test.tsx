import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskInWords, ExplainNumber, SummaryButton } from './Ai'

const settings = vi.fn()
const ask = vi.fn()
const summary = vi.fn()
vi.mock('@/api/endpoints', () => ({
  ai: {
    settings: () => settings(),
    ask: (t: string, q: string) => ask(t, q),
    summary: (t: string, id: string) => summary(t, id),
    explainNumber: vi.fn(),
  },
}))

const on = (tables: string[]) => ({ enabled: true, available: true, provider: 'groq', tables })

function setup(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

afterEach(() => vi.clearAllMocks())

describe('AI buttons', () => {
  it('render nothing at all while AI is off', async () => {
    settings.mockResolvedValue({ enabled: false, available: true, provider: null, tables: [] })
    setup(<><SummaryButton table="candidate" id="1" /><ExplainNumber measure="m" table="candidate" /><AskInWords table="candidate" onApply={vi.fn()} /></>)
    await waitFor(() => expect(settings).toHaveBeenCalled())
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('stay hidden for a table the admin did not allow, or when no provider is set up', async () => {
    settings.mockResolvedValue(on(['client']))
    setup(<SummaryButton table="candidate" id="1" />)
    await waitFor(() => expect(settings).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Summarise/ })).toBeNull()
  })

  it('apply the filters the AI chose and say what they were', async () => {
    settings.mockResolvedValue(on(['candidate']))
    ask.mockResolvedValue({ filters: { status: 'Active' }, q: '', cached: false })
    const apply = vi.fn()
    setup(<AskInWords table="candidate" onApply={apply} />)
    await userEvent.click(await screen.findByRole('button', { name: /Ask in words/ }))
    await userEvent.type(screen.getByLabelText(/^Ask in words/), 'active people')
    await userEvent.click(screen.getByRole('button', { name: 'Find' }))
    await waitFor(() => expect(apply).toHaveBeenCalledWith({ status: 'Active' }, ''))
    expect(await screen.findByText(/Applied 1 filter/)).toBeInTheDocument()
  })

  it('show the server message when the AI is unavailable, and keep the page usable', async () => {
    settings.mockResolvedValue(on(['candidate']))
    summary.mockRejectedValue(new Error("This month's AI limit has been reached. The rest of the app works as usual."))
    setup(<SummaryButton table="candidate" id="1" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarise/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('limit has been reached')
  })

  it('label a summary as a suggestion to check', async () => {
    settings.mockResolvedValue(on(['candidate']))
    summary.mockResolvedValue({ text: 'A Java developer in Pune.', used: ['Full name', 'Skills'], cached: false, prompt_version: 'x' })
    setup(<SummaryButton table="candidate" id="1" />)
    await userEvent.click(await screen.findByRole('button', { name: /Summarise/ }))
    expect(await screen.findByText('A Java developer in Pune.')).toBeInTheDocument()
    expect(screen.getByText('Check it before you use it.')).toBeInTheDocument()
    expect(screen.getByText(/Built from: Full name, Skills/)).toBeInTheDocument()
  })
})
