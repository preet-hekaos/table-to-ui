import { expect, type Browser, type Page } from '@playwright/test'
import { PASSWORD } from './helpers'

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

/** A brand new browser session signed in as the given user: it knows nothing the owner's page cached. */
export async function freshSession(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByTestId('app-name')).toBeVisible()
  return page
}
