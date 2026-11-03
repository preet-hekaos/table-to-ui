import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { featuresSaved, run, signUpWithPack } from './helpers'

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

test('Drag to reorder: custom order, drag, keyboard, switch off', async ({ page }) => {
  await signUpWithPack(page, `Order Co ${run}`, `order-${run}@order.test`)
  const made = await page.evaluate(async () => {
    const out: number[] = []
    for (const [i, name] of ['Asha Rao', 'Bimal Das', 'Chitra Iyer'].entries()) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name: name, email: `o${i}@example.in`, phone: `+91 98450 1234${i}`, status: 'Active' } }),
      })
      out.push(res.status)
    }
    return out
  })
  expect(made).toEqual([201, 201, 201])
  await page.goto('/s/candidates')
  const names = async () => (await page.getByRole('row').allInnerTexts()).slice(1).map((t) => t.match(/Asha Rao|Bimal Das|Chitra Iyer/)?.[0])

  await test.step('No handles until Custom order is on', async () => {
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0)
    await page.getByRole('switch', { name: 'Custom order' }).check()
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(3)
    const r = await new AxeBuilder({ page }).withTags(tags).analyze()
    expect(r.violations, r.violations.map((v) => `${v.id} (${v.nodes[0]?.html})`).join(', ')).toEqual([])
  })

  const start = await names()

  await test.step('Drag the last row to the top; the order stays after a reload', async () => {
    const last = start[2]!
    await page.getByRole('button', { name: `Move ${last}` }).dragTo(page.getByRole('row', { name: new RegExp(start[0]!) }))
    await expect.poll(names).toEqual([start[2], start[0], start[1]])
    await page.reload()
    await page.getByRole('switch', { name: 'Custom order' }).check()
    await expect.poll(names).toEqual([start[2], start[0], start[1]])
  })

  await test.step('The keyboard moves a row with the arrow keys', async () => {
    const top = page.getByRole('button', { name: `Move ${start[2]}` })
    await top.focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(names).toEqual([start[0], start[2], start[1]])
    await expect(page.getByRole('status').filter({ hasText: 'Moved' })).toContainText(`Moved ${start[2]}`)
  })

  await test.step('The list shows the same order with Custom order off, and after a reload', async () => {
    const order = [start[0], start[2], start[1]]
    await page.getByRole('switch', { name: 'Custom order' }).uncheck()
    await expect(page.getByRole('button', { name: /^Move / })).toHaveCount(0)
    await expect.poll(names).toEqual(order)
    await page.reload()
    await expect.poll(names).toEqual(order)
  })

  await test.step('Switching it off removes the toggle', async () => {
    await page.goto('/studio?tab=data&table=candidate&part=features')
    const panel = page.getByTestId('features-panel')
    await featuresSaved(page, () => panel.getByRole('switch', { name: /^Reorder rows/ }).uncheck())
  })
})
