import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'correct-horse-battery'
export const run = Date.now().toString(36)

/** Sign up and choose a pack (default Recruitment); lands in the workspace. */
export async function signUpWithPack(page: Page, name: string, email: string, pack: RegExp | 'blank' = /Recruitment agency/) {
  await page.goto('/signup')
  await page.getByLabel(/Workspace name/).fill(name)
  await page.getByLabel(/Your name/).fill('Ananya Rao')
  await page.getByLabel(/Work email/).fill(email)
  await page.getByLabel(/^Password/).fill(PASSWORD)
  await page.getByRole('button', { name: 'Create workspace' }).click()
  await expect(page.getByRole('heading', { name: /^Set up / })).toBeVisible()
  await page.waitForLoadState('networkidle')
  const choice = page.getByLabel(pack === 'blank' ? /Start blank/ : pack)
  const go = page.getByRole('button', { name: 'Set up workspace' })
  await expect(async () => {
    await choice.check()
    await expect(go).toBeEnabled({ timeout: 1000 })
  }).toPass()
  await go.click()
  await expect(page.getByTestId('app-name')).toHaveText(name)
  await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible() // onboarding has finished navigating home
}
