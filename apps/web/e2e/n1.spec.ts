import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { openTables, run, signUpWithPack } from './helpers'

/** N1: Draft, Test and Live each have their own colour, word and icon, and the colour follows a change. */
test('Stage colours follow a field from Draft to Test to Live', async ({ page }) => {
  await signUpWithPack(page, `Stages Co ${run}`, `stages-${run}@stages.test`)
  const row = () => page.getByRole('row', { name: /^preferred_shift / })

  await test.step('A new field is Draft (amber) and the Draft step counts it', async () => {
    await page.goto('/studio')
    await page.getByRole('button', { name: 'Add field' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Label/).fill('Preferred shift')
    await dialog.getByLabel('Type').selectOption('select')
    await dialog.getByLabel(/^Choices/).fill('Day, Night')
    await dialog.getByRole('button', { name: 'Add field' }).click()
    await expect(row()).toHaveAttribute('data-stage', 'draft')
    await expect(row().getByText('Draft')).toBeVisible()
    await expect(page.getByTestId('env-draft')).toContainText('1 waiting')
    // Existing fields are untouched, so they stay Live
    await expect(page.getByRole('row', { name: /^current_employer / })).toHaveAttribute('data-stage', 'live')
    await expect((await openTables(page)).getByRole('img', { name: 'Draft' }).first()).toBeVisible()
    await page.keyboard.press('Escape')
  })

  await test.step('The colour key explains all four colours', async () => {
    await page.getByRole('group', { name: 'Environments' }).hover()
    const key = page.getByRole('list', { name: 'What the colours mean' })
    for (const w of ['Draft', 'Test', 'Live', 'Removed']) await expect(key.getByText(w, { exact: true })).toBeVisible()
    await page.mouse.move(0, 0)
    await expect(key).toBeHidden()
  })

  await test.step('Published to Test it turns blue', async () => {
    await page.getByTestId('draft-banner').getByRole('button', { name: 'Publish Draft to Test' }).click()
    await expect(page.getByText(/is in Test/).first()).toBeVisible()
    await expect(row()).toHaveAttribute('data-stage', 'test')
    await expect(row().getByText('Test')).toBeVisible()
    await expect(page.getByTestId('env-test')).toContainText('not yet Live')
  })

  await test.step('Made Live it turns green and the badge steps back', async () => {
    await page.goto('/studio?tab=versions')
    await page.getByRole('button', { name: 'Make Live' }).first().click()
    await expect(page.getByText(/is now Live/).first()).toBeVisible()
    await page.goto('/studio')
    await expect(row()).toHaveAttribute('data-stage', 'live')
    await expect(page.getByTestId('env-live')).toContainText('v')
  })

  await test.step('A removed field shows as Removed until published; the page passes the accessibility check', async () => {
    await page.getByRole('button', { name: 'Edit Preferred shift' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete field' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const gone = page.locator('tr[data-stage="removed"]')
    await expect(gone).toContainText('Preferred shift')
    await expect(gone).toContainText('goes away when published')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations).toEqual([])
  })
})
