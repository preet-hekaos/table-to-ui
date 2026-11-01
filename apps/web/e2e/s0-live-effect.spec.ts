import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

/**
 * S0 sample of the Studio-to-live pattern, using one setting: Required.
 * Owner adds a required field in Studio and publishes; a separate browser session then sees it on the real form.
 * Later stages copy this shape for every setting in tests/live_effects/register.py.
 */
test('live effect: a field made required in Studio is required on the live form', async ({ page, browser }) => {
  const email = `s0-${run}@studio.test`
  await signUpWithPack(page, `S0 Co ${run}`, email)

  await test.step('Owner adds a required field in Studio; it is not on the live form yet', async () => {
    await page.goto('/studio')
    await page.getByRole('button', { name: 'Add field' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel(/^Label/).fill('Badge number')
    await dialog.getByLabel('Required').check()
    await dialog.getByRole('button', { name: 'Add field' }).click()
    await expect(page.getByRole('row', { name: /^badge_number / })).toBeVisible()
    await page.goto('/records/candidate/new')
    await expect(page.getByLabel(/^Badge number/)).toHaveCount(0)
  })

  await test.step('Owner publishes', async () => {
    await publishLive(page)
  })

  await test.step('A fresh session sees the field marked required and cannot save without it', async () => {
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await expect(live.getByLabel(/^Badge number/)).toBeVisible()
    await expect(live.getByText('Badge number').first()).toBeVisible()
    await live.getByLabel(/Full name/).fill('Required Check')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('Badge number is required')).toBeVisible()
    await live.getByLabel(/^Badge number/).fill('B-100')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('Badge number is required')).toHaveCount(0)
    await live.context().close()
  })
})
