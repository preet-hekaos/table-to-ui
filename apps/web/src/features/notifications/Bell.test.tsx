import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/design-system'
import { NotificationBell } from './Bell'

const inbox = vi.fn()
const read = vi.fn()
vi.mock('@/api/endpoints', () => ({
  notifications: {
    inbox: () => inbox(),
    read: (ids?: string[]) => read(ids),
    prefs: () => Promise.resolve({ kinds: [{ kind: 'task', label: 'Tasks given to me', channel: 'in_app' }], digest: true }),
    savePrefs: vi.fn(),
  },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

const item = (id: string, title: string, read = false) => ({ id, kind: 'task', title, link: null, created_at: new Date().toISOString(), read })

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <NotificationBell />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.clearAllMocks())

describe('NotificationBell', () => {
  it('says how many are unread in its name and lists them', async () => {
    inbox.mockResolvedValue({ unread: 2, items: [item('1', 'Screen Neha'), item('2', 'Call Ravi')] })
    setup()
    const button = await screen.findByRole('button', { name: 'Notifications, 2 unread' })
    await userEvent.click(button)
    expect(await screen.findByText('Screen Neha')).toBeInTheDocument()
    expect(screen.getByText('Call Ravi')).toBeInTheDocument()
  })

  it('marks everything read and shows a quiet bell when nothing is unread', async () => {
    inbox.mockResolvedValueOnce({ unread: 1, items: [item('1', 'Screen Neha')] }).mockResolvedValue({ unread: 0, items: [item('1', 'Screen Neha', true)] })
    read.mockResolvedValue({ marked: 1, unread: 0 })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }))
    await waitFor(() => expect(read).toHaveBeenCalledWith(undefined))
    await waitFor(() => expect(screen.queryByTestId('bell-count')).toBeNull())
  })

  it('has a friendly empty state', async () => {
    inbox.mockResolvedValue({ unread: 0, items: [] })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    expect(await screen.findByText('Nothing yet')).toBeInTheDocument()
  })

  it('offers per-kind settings and the daily summary switch', async () => {
    inbox.mockResolvedValue({ unread: 0, items: [] })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: 'Notifications' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(await screen.findByLabelText('Tasks given to me')).toHaveValue('in_app')
    expect(screen.getByLabelText(/Email me one summary a day/)).toBeChecked()
  })
})
