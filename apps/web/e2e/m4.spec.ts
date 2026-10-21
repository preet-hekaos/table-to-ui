/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns untyped API JSON */
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `../../docs/screens/m4/${name}.png`, fullPage: true })
}

async function api<T = Record<string, any>>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ([m, p, b]) => {
      const res = await fetch(p as string, {
        method: m as string,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: b === undefined ? undefined : JSON.stringify(b),
      })
      if (res.status === 204) return null
      const json = await res.json()
      if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`)
      return json
    },
    [method, path, body] as const,
  ) as Promise<T>
}

const bell = (page: Page) => page.getByRole('button', { name: /^Notifications/ })

/** The M4 demo script: a reminder arrives by itself, I see it, act on it, and tune how I hear about things. */
test('M4 demo: automation, notifications and guided start', async ({ page }) => {
  await signUpWithPack(page, `Northstar M4 ${run}`, `m4-${run}@northstar.test`)

  await test.step('1. The Studio lists the five starter automations in plain sentences', async () => {
    await page.goto('/studio?tab=automations')
    await expect(page.getByRole('tab', { name: 'Automations' })).toHaveAttribute('aria-selected', 'true')
    const list = page.getByRole('list', { name: 'Automations' })
    await expect(list.getByRole('listitem')).toHaveCount(5)
    await expect(page.getByTestId('automation-row-screening_task_new_candidate')).toContainText('When a candidate is added')
    await expect(page.getByTestId('automation-row-interview_reminder')).toContainText('1 day before “Scheduled on” of an interview')
    await shot(page, 'automations')
  })

  await test.step('2. Adding a candidate gives me a task and a notification, without slowing the save', async () => {
    const t0 = Date.now()
    await api(page, 'POST', '/v1/records/candidate', {
      data: { full_name: 'Neha Iyer', email: `neha-${run}@gmail.com`, phone: '+91 98450 12345', status: 'Active' },
    })
    expect(Date.now() - t0).toBeLessThan(3000)
    // the automation runs after the save, from the outbox
    await expect
      .poll(async () => (await api<{ tasks: { total: number } }>(page, 'GET', '/v1/me/needs')).tasks.total, { timeout: 20_000 })
      .toBe(1)
    await page.goto('/')
    const needs = page.getByTestId('what-needs-me')
    await expect(needs.getByText('Screen Neha Iyer')).toBeVisible({ timeout: 20_000 })
    await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread')
    await shot(page, 'home-what-needs-me')
  })

  await test.step('3. I tick the task off from Home', async () => {
    await page.getByRole('button', { name: 'Mark done: Screen Neha Iyer' }).click()
    await expect(page.getByTestId('what-needs-me').getByText('Screen Neha Iyer')).toHaveCount(0)
  })

  await test.step('4. The bell lists it, I read it, and I choose how to hear about tasks', async () => {
    await bell(page).click()
    const d = page.getByRole('dialog', { name: 'Notifications' })
    await expect(d.getByText('New task: Screen Neha Iyer')).toBeVisible()
    await shot(page, 'bell')
    const axe = await new AxeBuilder({ page }).include('[role=dialog]').analyze()
    expect(axe.violations).toEqual([])
    await d.getByRole('button', { name: 'Mark all as read' }).click()
    await expect(page.getByTestId('bell-count')).toHaveCount(0)
    await d.getByRole('button', { name: 'Settings' }).click()
    const settings = page.getByRole('dialog', { name: 'Notification settings' })
    await settings.getByLabel('Tasks given to me').selectOption('in_app_email')
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await expect(settings.getByLabel('Email me one summary a day of anything I have not read')).toBeChecked()
    await shot(page, 'notification-settings')
    await page.keyboard.press('Escape')
  })

  await test.step('5. I build an automation in plain words and see how many records it would match', async () => {
    await api(page, 'POST', '/v1/records/task', { data: { title: 'Ring the client', status: 'Open' } })
    await page.goto('/studio?tab=automations')
    await page.getByRole('button', { name: 'Add an automation' }).click()
    const d = page.getByRole('dialog')
    await d.getByLabel('Name').fill('Tell me when a task is done')
    await d.getByLabel('Which records').selectOption({ label: 'Tasks' })
    await d.getByLabel('Happens when').selectOption('changed')
    await d.getByLabel(/^Field/).selectOption({ label: 'Status' })
    await d.getByLabel('Becomes').fill('Open')
    await d.getByLabel('Message').fill('Finished: {title}')
    await expect(d.getByTestId('automation-preview')).toContainText(/Would have matched 1 record/, { timeout: 10_000 })
    await shot(page, 'automation-builder')
    await d.getByLabel('Becomes').fill('Done')
    await d.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByTestId('automation-row-tell_me_when_a_task_is_done')).toContainText('becomes Done')
    const rel = await api<{ version: number }>(page, 'POST', '/v1/apps/current/releases')
    await api(page, 'POST', `/v1/apps/current/releases/${rel.version}/promote`)
  })

  await test.step('6. Finishing a task now tells me, and the run is on record', async () => {
    const tasks = await api<{ items: { id: string; version: number; data: any }[] }>(page, 'GET', '/v1/records/task')
    const t = tasks.items.find((x) => x.data.title === 'Ring the client')!
    await api(page, 'PATCH', `/v1/records/task/${t.id}`, { version: t.version, data: { status: 'Done' } })
    await page.goto('/')
    await expect(bell(page)).toHaveAccessibleName('Notifications, 1 unread', { timeout: 20_000 })
    await bell(page).click()
    await expect(page.getByRole('dialog').getByText('Finished: Ring the client')).toBeVisible()
    await page.keyboard.press('Escape')
    await page.goto('/studio?tab=automations')
    await expect(page.getByTestId('automation-runs').getByText('Tell me when a task is done').first()).toBeVisible()
  })

  await test.step('7. Sample data goes in with one click and out with one click', async () => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Add sample data' }).click()
    await expect(page.getByRole('button', { name: 'Remove sample data' })).toBeVisible({ timeout: 20_000 })
    await shot(page, 'sample-data')
    const cands = await api<{ items: any[] }>(page, 'GET', '/v1/records/candidate')
    expect(cands.items.map((c) => c.data.full_name)).toContain('Sample - Aarav Shah')
    await page.getByRole('button', { name: 'Remove sample data' }).click()
    await expect(page.getByRole('button', { name: 'Add sample data' })).toBeVisible({ timeout: 20_000 })
    const after = await api<{ items: any[] }>(page, 'GET', '/v1/records/candidate')
    expect(after.items.map((c) => c.data.full_name)).toEqual(['Neha Iyer'])
  })

  await test.step('8. Home is accessible and fits a phone', async () => {
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/')
    await expect(page.getByTestId('what-needs-me')).toBeVisible()
    const axe = await new AxeBuilder({ page }).analyze()
    expect(axe.violations).toEqual([])
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test('M4: the daily summary unsubscribe link works without signing in', async ({ page }) => {
  await page.goto('/unsubscribe?token=not-a-real-token')
  await page.getByRole('button', { name: 'Stop the daily emails' }).click()
  await expect(page.getByRole('alert')).toContainText('not valid')
  const axe = await new AxeBuilder({ page }).analyze()
  expect(axe.violations).toEqual([])
})
