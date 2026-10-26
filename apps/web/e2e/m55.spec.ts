import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { run, signUpWithPack } from './helpers'

const shot = async (page: Page, name: string) => {
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `../../docs/screens/m55/${name}.png`, fullPage: true })
}

/** The M5.5 demo script on the built-in demo provider: a blank workspace builds its first table by chat. */
test('M5.5 demo: set up a new workspace by chat, apply to Draft, undo', async ({ page }) => {
  await signUpWithPack(page, `Blank M55 ${run}`, `m55-${run}@blank.test`, 'blank')

  await test.step('1. Turn AI on (no published app needed)', async () => {
    await page.goto('/settings?tab=ai')
    await page.getByLabel('Turn AI on for this workspace').check()
    await page.getByRole('button', { name: 'Save AI settings' }).click()
    await expect(page.getByText('AI settings saved', { exact: true })).toBeVisible()
  })

  await test.step('2. Describe what to track', async () => {
    await page.goto('/studio?tab=chat')
    await expect(page.getByRole('tab', { name: 'Set up by chat' })).toHaveAttribute('aria-selected', 'true')
    await shot(page, 'empty')
    await page.getByLabel('What should change?').fill('Track our projects with a status')
    await page.getByRole('button', { name: 'Make a plan' }).click()
    const plan = page.getByTestId('setup-plan')
    await expect(plan).toBeVisible()
    await expect(plan.getByText('Add a table called “Project”, with a list screen and a menu entry')).toBeVisible()
    await expect(plan.getByRole('checkbox')).toHaveCount(2)
    await shot(page, 'plan')
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  })

  await test.step('3. Apply to the Draft', async () => {
    await page.getByRole('button', { name: 'Add 2 steps to the Draft' }).click()
    await expect(page.getByTestId('setup-applied')).toBeVisible()
    await expect(page.getByTestId('draft-banner')).toBeVisible()
    await shot(page, 'applied')
    await page.getByRole('tab', { name: 'Tables' }).click()
    await expect(page.getByText('Project', { exact: true }).first()).toBeVisible()
  })

  await test.step('4. Undo puts the Draft back', async () => {
    await page.getByRole('tab', { name: 'Set up by chat' }).click()
    await page.getByRole('button', { name: 'Undo this plan' }).click()
    await expect(page.getByTestId('setup-applied')).toHaveCount(0)
    await expect(page.getByTestId('draft-banner')).toHaveCount(0)
  })
})
