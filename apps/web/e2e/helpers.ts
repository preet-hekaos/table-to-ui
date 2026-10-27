import { expect, type Locator, type Page } from '@playwright/test'

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

/**
 * Visual check: the text of an element can be read against the colour behind it, in its resting, hovered and focused states.
 * axe cannot do this for hover states, which is how a white page number on a pale hover once slipped through.
 */
export async function expectReadable(page: Page, locator: Locator, states: Array<'rest' | 'hover' | 'focus'> = ['rest', 'hover', 'focus'], min = 4.5) {
  for (const state of states) {
    if (state === 'hover') await locator.hover()
    else if (state === 'focus') await locator.focus()
    else await page.mouse.move(0, 0)
    await page.waitForTimeout(300) // let colour transitions finish
    const ratio = await locator.evaluate((el) => {
      const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number)
      const lum = ([r = 0, g = 0, b = 0]: number[]) => {
        const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
      }
      let bg: number[] = [255, 255, 255]
      for (let n: Element | null = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor)
        if (c.length >= 3 && (c[3] ?? 1) > 0.5) { bg = c; break }
      }
      const fg = parse(getComputedStyle(el).color)
      const [a, b] = [lum(fg), lum(bg)]
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
    })
    expect(ratio, `${state} contrast`).toBeGreaterThanOrEqual(min)
  }
}
