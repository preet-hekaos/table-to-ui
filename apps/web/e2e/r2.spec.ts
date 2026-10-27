import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { expectReadable, run, signUpWithPack } from './helpers'

test('Table card: numbered pages, page size, columns, density, full screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signUpWithPack(page, `Card Co ${run}`, `card-${run}@card.test`)
  const made = await page.evaluate(async () => {
    let ok = 0
    for (let i = 0; i < 32; i++) {
      const res = await fetch('/v1/records/candidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` },
        body: JSON.stringify({ data: { full_name: i === 7 ? 'Zebulon Quark' : `Person ${String(i).padStart(2, '0')}`, email: `c${i}@example.in`, phone: `+91 98450 ${String(10000 + i)}`, status: 'Active' } }),
      })
      if (res.status === 201) ok++
    }
    return ok
  })
  expect(made).toBe(32)
  await page.goto('/s/candidates')
  const card = page.getByTestId('table-card')
  const pager = page.getByTestId('pagination')
  await expect(card).toBeVisible()
  await expect(pager).toBeVisible()

  await test.step('Visual: text stays readable at rest, on hover and on focus', async () => {
    await expectReadable(page, pager.getByRole('button', { name: 'Page 1' }))
    await expectReadable(page, page.getByRole('button', { name: 'Columns' }))
    await expectReadable(page, page.getByRole('button', { name: 'Compact' }))
    await expectReadable(page, pager.getByRole('button', { name: 'Next page' }))
    await testInfo.attach('table-card', { body: await page.screenshot(), contentType: 'image/png' })
  })

  await test.step('Pages of 25, then page 2 shows the rest', async () => {
    await expect(page.getByTestId('page-range')).toContainText('Showing 1 to 25 of 32')
    await pager.getByRole('button', { name: /^(Page )?2$|Go to page 2/ }).first().click()
    await expect(page.getByTestId('page-range')).toContainText('Showing 26 to 32 of 32')
    expect(page.url()).toContain('page=2')
    await expectReadable(page, pager.getByRole('button', { name: 'Page 2' })) // the current page, hovered, was once unreadable
    await page.reload()
    await expect(page.getByTestId('page-range')).toContainText('Showing 26 to 32 of 32')
  })

  await test.step('A new page size returns to page 1', async () => {
    await page.getByLabel('Rows per page').selectOption('50')
    await expect(page.getByTestId('page-range')).toContainText('Showing 1 to 32 of 32')
  })

  await test.step('A search returns to page 1 and the total follows', async () => {
    await page.locator('#list-q').fill('Zebulon')
    await expect(page.getByTestId('page-range')).toContainText('of 1')
  })
  await page.locator('#list-q').fill('')

  await test.step('Hide a column; it stays hidden after reload', async () => {
    await page.getByRole('button', { name: 'Columns' }).click()
    await page.getByRole('checkbox', { name: 'Location', exact: true }).uncheck()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('columnheader', { name: /Location/ })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('columnheader', { name: /Location/ })).toHaveCount(0)
  })

  await test.step('Density and full screen', async () => {
    const h = async () => (await page.getByRole('row').nth(1).boundingBox())!.height
    const compact = await h()
    await page.getByRole('button', { name: 'Compact' }).click()
    expect(await h()).toBeGreaterThan(compact)
    await page.getByTestId('table-toolbar').getByRole('button', { name: 'Full screen' }).click()
    await expect(page.locator('[data-sidebar]')).toBeHidden()
    await page.getByRole('button', { name: 'Exit full screen' }).first().click()
    await expect(page.locator('[data-sidebar]')).toBeVisible()
  })

  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
})
