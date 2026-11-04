import type { Page } from '@playwright/test'

/** Click the "Archive …" button already on screen, then pass the type-to-confirm step. */
export async function confirmArchive(page: Page, trigger: RegExp, word: string) {
  await page.getByRole('button', { name: trigger }).click()
  const dialog = page.getByTestId('archive-dialog')
  const phrase = (await dialog.locator('label[for=archive-confirm] code').innerText()).trim()
  await dialog.locator('#archive-confirm').fill(phrase)
  await dialog.getByRole('button', { name: new RegExp(`archive this ${word}`, 'i') }).click()
}
