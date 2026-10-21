/* eslint-disable @typescript-eslint/no-explicit-any -- test helper returns untyped API JSON */
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `../../docs/screens/m2-5/${name}.png`, fullPage: true })
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

/** The M2.5 demo script: an admin links tables from the Studio, publishes, and the parent page shows the link. */
test('M2.5 demo: relationship builder', async ({ page }) => {
  await signUpWithPack(page, `Northstar M25 ${run}`, `m25-${run}@northstar.test`)
  await api(page, 'POST', '/v1/studio/tables', { label: 'Tag' })

  await test.step('1. The Relationships tab lists every link with its source and use', async () => {
    await page.goto('/studio?tab=links')
    await expect(page.getByTestId('link-submission.candidate')).toContainText('Comes with the pack')
    await expect(page.getByTestId('link-submission.candidate')).toContainText('0 records use it')
  })

  await test.step('2. Add a link; the dialog reads as a sentence', async () => {
    await page.getByRole('button', { name: 'Add a link' }).click()
    await page.getByLabel('Each…').selectOption('candidate')
    await page.getByLabel('…belongs to one').selectOption('tag')
    await page.getByLabel('Field label').fill('Favourite tag')
    await expect(page.getByText('Each Candidate belongs to one Tag.')).toBeVisible()
    await shot(page, '01-add-a-link')
    await page.getByRole('button', { name: 'Add link' }).click()
    await expect(page.getByTestId('link-candidate.favourite_tag')).toContainText('Yours')
  })

  await test.step('3. A duplicate link is refused with a clear message', async () => {
    await page.getByRole('button', { name: 'Add a link' }).click()
    await page.getByLabel('Each…').selectOption('candidate')
    await page.getByLabel('…belongs to one').selectOption('tag')
    await page.getByLabel('Field label').fill('favourite tag')
    await page.getByRole('button', { name: 'Add link' }).click()
    await expect(page.getByText(/already links to Tag/).first()).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('4. Add a many-to-many link between two tables', async () => {
    await page.getByRole('button', { name: 'Add a many-to-many link' }).click()
    await page.getByLabel('First table').selectOption('candidate')
    await page.getByLabel('Second table').selectOption('tag')
    await page.getByRole('button', { name: 'Add link' }).click()
    await expect(page.getByTestId('link-candidate_and_tag.candidate')).toContainText('required')
    await shot(page, '02-relationships')
  })

  await test.step('5. Rename a link; a pack link cannot be removed', async () => {
    await page.getByRole('button', { name: 'Edit link Favourite tag on Candidate' }).click()
    await page.getByRole('textbox', { name: 'Label' }).fill('Main tag')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByTestId('link-candidate.favourite_tag')).toContainText('Main tag')
    await page.getByRole('button', { name: 'Edit link Candidate on Submission' }).click()
    await expect(page.getByRole('button', { name: 'Remove link' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('6. On the canvas, drag a box, drag from one box to another to link them, and the position is kept', async () => {
    await page.goto('/studio?tab=map')
    const canvas = page.getByTestId('canvas')
    await expect(canvas.getByTestId('box-candidate')).toBeVisible()
    const box = await canvas.getByTestId('box-candidate').boundingBox()
    await page.mouse.move(box!.x + 60, box!.y + 12)
    await page.mouse.down()
    await page.mouse.move(box!.x + 160, box!.y + 90, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => Object.keys((await api<any>(page, 'GET', '/v1/studio/layout')).positions).length).toBeGreaterThan(0)
    const moved = (await api<any>(page, 'GET', '/v1/studio/layout')).positions.candidate
    await page.reload()
    await expect(page.getByTestId('box-candidate')).toBeVisible()
    expect((await api<any>(page, 'GET', '/v1/studio/layout')).positions.candidate).toEqual(moved)
    const src = await page.locator('[data-testid="box-client"] .react-flow__handle.source').boundingBox()
    const dst = await page.locator('[data-testid="box-skill"] .react-flow__handle.target').boundingBox()
    await page.mouse.move(src!.x + src!.width / 2, src!.y + src!.height / 2)
    await page.mouse.down()
    await page.mouse.move(dst!.x + dst!.width / 2, dst!.y + dst!.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(page.getByText('Each Client belongs to one Skill.')).toBeVisible()
    await shot(page, '04-canvas-connect')
    await page.getByRole('button', { name: 'Add link' }).click()
    await expect(page.getByText(/Link added/).first()).toBeVisible()
    await shot(page, '05-canvas')
  })

  await test.step('6b. A line on the canvas opens its link', async () => {
    await page.goto('/studio?tab=map')
    await page.getByText('Links as a list').click()
    await page.getByRole('button', { name: /Candidate → Tag/ }).first().click()
    await expect(page.getByRole('heading', { name: /Edit Main tag/ })).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('7. After publish, a used link cannot be removed and the parent page lists it', async () => {
    const rel = await api<any>(page, 'POST', '/v1/apps/current/releases')
    await api(page, 'POST', `/v1/apps/current/releases/${rel.version}/promote`)
    const tag = await api<any>(page, 'POST', '/v1/records/tag', { data: { name: 'Hot' } })
    await api(page, 'POST', '/v1/records/candidate', {
      data: { full_name: 'Tagged Person', email: 'tp@example.in', phone: '+91 98450 11111', status: 'Active', favourite_tag: tag.id },
    })
    await page.goto(`/records/tag/${tag.id}`)
    await page.getByRole('tab', { name: 'Candidates' }).click()
    await expect(page.getByText('Tagged Person')).toBeVisible()
    await shot(page, '03-parent-page')
    await page.goto('/studio?tab=links')
    await expect(page.getByTestId('link-candidate.favourite_tag')).toContainText('1 record uses it')
    await page.getByRole('button', { name: 'Edit link Main tag on Candidate' }).click()
    await page.getByRole('button', { name: 'Remove link' }).click()
    await expect(page.getByText('Could not remove the link', { exact: true })).toBeVisible()
  })

  await test.step('7b. Link health explains risky links in plain words and refuses a required loop', async () => {
    await api(page, 'POST', '/v1/studio/relationships', { table: 'candidate', to: 'candidate', label: 'Referred by' })
    await api(page, 'POST', '/v1/studio/relationships', { table: 'tag', to: 'candidate', label: 'Main person', required: true })
    await expect(api(page, 'POST', '/v1/studio/relationships', { table: 'candidate', to: 'tag', label: 'Lead tag', required: true })).rejects.toThrow(/circular_required/)
    await page.goto('/studio?tab=links')
    const panel = page.getByTestId('link-health')
    await expect(panel).toContainText('Good to know')
    await expect(panel).toContainText('Referred by')
    await shot(page, 'link-health')
  })

  await test.step('8. The tab passes WCAG 2.2 AA and fits a 360 px phone', async () => {
    await page.goto('/studio?tab=map')
    await expect(page.getByTestId('canvas')).toBeVisible()
    const canvasAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(canvasAxe.violations, canvasAxe.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
    await page.goto('/studio?tab=links')
    await expect(page.getByRole('list', { name: 'Links' })).toBeVisible()
    const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
    await page.setViewportSize({ width: 360, height: 740 })
    await page.goto('/studio?tab=links')
    await expect(page.getByRole('list', { name: 'Links' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, 'scrolls sideways at 360px').toBeLessThanOrEqual(0)
  })
})
