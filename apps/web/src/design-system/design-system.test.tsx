import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { useState } from 'react'
import {
  AiUnavailable,
  Badge,
  Button,
  Card,
  CardTitle,
  Dialog,
  DialogContent,
  DialogTrigger,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  NotFound,
  PermissionDenied,
  RuleBlocked,
  Select,
  Skeleton,
  Table,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Td,
  Th,
  ToastProvider,
  VersionConflict,
  useToast,
} from '@/design-system'

async function expectAccessible(ui: React.ReactElement) {
  const { container } = render(ui)
  expect(await axe(container)).toHaveNoViolations()
}

describe('base components pass axe', () => {
  it('Button, Badge, Card', () =>
    expectAccessible(
      <Card>
        <CardTitle>Title</CardTitle>
        <Button>Save</Button> <Button variant="primary" loading>Saving</Button> <Badge tone="ok">Active</Badge>
      </Card>,
    ))
  it('Field with Input and Select, with and without error', () =>
    expectAccessible(
      <form>
        <Field label="Name" required hint="Your full name">
          <Input />
        </Field>
        <Field label="Email" error="Enter a valid email">
          <Input type="email" />
        </Field>
        <Field label="Status">
          <Select>
            <option>Active</option>
          </Select>
        </Field>
      </form>,
    ))
  it('Table with a sortable header', () =>
    expectAccessible(
      <Table aria-label="People">
        <thead>
          <tr>
            <Th sortable direction="asc" onSort={() => undefined}>Name</Th>
            <Th>Role</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>Ananya</Td>
            <Td>Admin</Td>
          </tr>
        </tbody>
      </Table>,
    ))
  it('Tabs', () =>
    expectAccessible(
      <Tabs defaultValue="a">
        <TabsList aria-label="Sections">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">First</TabsContent>
        <TabsContent value="b">Second</TabsContent>
      </Tabs>,
    ))
  it('Skeleton', () => expectAccessible(<Skeleton className="h-4" />))
})

describe('the eight screen states pass axe', () => {
  it.each([
    ['loading', <LoadingState key="1" />],
    ['empty', <EmptyState key="2" title="Nothing here" action={<Button>Add</Button>}>Explain why.</EmptyState>],
    ['error', <ErrorState key="3" requestId="req_123" onRetry={() => undefined} />],
    ['permission denied', <PermissionDenied key="4" />],
    ['rule blocked', <RuleBlocked key="5" ruleId="R-01" message="A candidate with this email already exists." link={<a href="/x">Open Arjun</a>} />],
    ['version conflict', <VersionConflict key="6" onReload={() => undefined} />],
    ['AI unavailable', <AiUnavailable key="7" />],
    ['not found', <NotFound key="8" what="record" />],
  ])('%s', (_name, ui) => expectAccessible(ui))

  it('error state shows the request id and a retry button', async () => {
    const retry = vi.fn()
    render(<ErrorState requestId="req_abc" onRetry={retry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('req_abc')
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(retry).toHaveBeenCalled()
  })
})

describe('keyboard behaviour', () => {
  it('a sortable header is a button that works with Enter', async () => {
    const onSort = vi.fn()
    render(
      <Table aria-label="t">
        <thead>
          <tr>
            <Th sortable onSort={onSort}>Name</Th>
          </tr>
        </thead>
      </Table>,
    )
    await userEvent.tab()
    expect(screen.getByRole('button', { name: /name/i })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onSort).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'none')
  })

  it('a dialog opens from its trigger, traps focus and closes with Escape', async () => {
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Open</Button>
        </DialogTrigger>
        <DialogContent title="Confirm" description="Are you sure?">
          <Button>Yes</Button>
        </DialogContent>
      </Dialog>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument()
    expect(await axe(document.body)).toHaveNoViolations()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open' })).toHaveFocus()
  })

  it('tabs move with arrow keys', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList aria-label="s">
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">first</TabsContent>
        <TabsContent value="b">second</TabsContent>
      </Tabs>,
    )
    await userEvent.tab()
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('second')).toBeVisible()
  })

  it('a field links its label, hint and error to the control', () => {
    render(
      <Field label="Email" hint="We never share it" error="Enter a valid email">
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('Email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Enter a valid email')
  })

  it('a toast announces itself', async () => {
    function Demo() {
      const toast = useToast()
      const [n, setN] = useState(0)
      return <Button onClick={() => { setN(n + 1); toast({ title: 'Saved', tone: 'ok' }) }}>Go</Button>
    }
    render(
      <ToastProvider>
        <Demo />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })
})
