import { expect, type Browser, type Page } from '@playwright/test'

/**
 * Studio-to-live helpers (S0 of the Studio table redesign).
 * The pattern for every setting: the owner changes it in Studio, publishes, and then a separate browser session
 * (no shared cookies or cached screens) opens the real screen and checks the effect.
 */

/** Publish the Draft to Test and make it Live, the way the owner does from the Studio banner and Versions tab. */
export async function publishLive(page: Page) {
  await page.goto('/studio')
  await page.getByTestId('draft-banner').getByRole('button', { name: 'Publish Draft to Test' }).click()
  await expect(page.getByText(/is in Test/).first()).toBeVisible()
  await page.goto('/studio?tab=versions')
  await page.getByRole('button', { name: 'Make Live' }).first().click()
  await expect(page.getByText(/is now Live/).first()).toBeVisible()
}

/**
 * A brand new browser session for the same signed-in user: its own context and an empty cache, so it knows nothing
 * the owner's page held in memory. The sign-in token is carried over because sign-in itself may ask for a second step.
 */
export async function freshSession(browser: Browser, owner: Page): Promise<Page> {
  const token = await owner.evaluate(() => sessionStorage.getItem('tableui.token'))
  expect(token, 'the owner is signed in').toBeTruthy()
  const context = await browser.newContext()
  await context.addInitScript((t) => sessionStorage.setItem('tableui.token', t as string), token)
  const page = await context.newPage()
  await page.goto('/')
  await expect(page.getByTestId('app-name')).toBeVisible()
  return page
}
