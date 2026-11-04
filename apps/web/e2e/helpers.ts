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
  await expect(page.getByRole('heading', { name: /^Set up / })).toBeVisible({ timeout: 30_000 }) // creating a workspace builds its database schema; slow on shared CI machines
  await page.waitForLoadState('networkidle')
  const choice = page.getByLabel(pack === 'blank' ? /Start blank/ : pack)
  const go = page.getByRole('button', { name: 'Set up workspace' })
  await expect(async () => {
    await choice.check()
    await expect(go).toBeEnabled({ timeout: 1000 })
  }).toPass()
  await go.click()
  await expect(page.getByTestId('app-name')).toHaveText(name)
  await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ })).toBeVisible({ timeout: 30_000 }) // onboarding has finished navigating home
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

/** Open the Studio table picker and return its list of tables. */
export async function openTables(page: Page) {
  await page.getByRole('button', { name: /Change table/ }).click()
  return page.getByRole('navigation', { name: 'Tables' })
}

/** Run one of the schema actions from the Studio "More" menu. */
export async function schemaAction(page: Page, name: 'Import schema' | 'Export schema') {
  const more = page.getByRole('button', { name: 'More table actions' })
  const direct = page.getByRole('button', { name, exact: true })
  await more.or(direct).first().waitFor()
  if (await more.count()) {
    await more.click()
    await page.getByRole('menuitem', { name }).click()
  } else {
    await page.getByRole('button', { name }).click() // the Canvas tab keeps its own buttons
  }
}

/** Go to a Studio section from the section switcher in the toolbar. */
export async function openSection(page: Page, name: 'Tables' | 'Canvas' | 'Stages & rules' | 'Automations' | 'Insights' | 'Menu' | 'Preview' | 'Versions') {
  await page.getByRole('button', { name: /Change section/ }).click()
  await page.getByRole('navigation', { name: 'Studio sections' }).getByRole('button', { name: new RegExp(`^${name.replace('&', '&')}`) }).click()
}

/** The Studio is on this section: the switcher names it. */
export async function expectSection(page: Page, name: string) {
  await expect(page.getByRole('button', { name: new RegExp(`^Section: ${name}\\.`) })).toBeVisible()
}

/** Set a table's features through the API, the way an older Studio screen or an integration would. */
export async function putFeatures(page: Page, table: string, body: Record<string, unknown>) {
  const status = await page.evaluate(
    async ([t, b]) => (await fetch(`/v1/studio/tables/${t}/features`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionStorage.getItem('tableui.token')}` }, body: JSON.stringify(b) })).status,
    [table, body] as [string, Record<string, unknown>],
  )
  expect(status).toBe(200)
}

/** In the Add field dialog: open the Type picker, choose a type by its name, and confirm. */
export async function pickNewFieldType(page: Page, name: RegExp | string) {
  await page.getByRole('dialog', { name: /^Add a field to/ }).getByRole('button', { name: /^Type: / }).click()
  const picker = page.getByRole('dialog', { name: 'Type picker' })
  await picker.getByRole('option', { name }).click()
  await picker.getByRole('button', { name: /^Use / }).click()
}

/** In the Fields grid: open a field's Features cell and set one tick by its name in the dropdown. */
export async function setFieldFeature(page: Page, fieldLabel: string, tick: string, on: boolean) {
  await page.getByRole('button', { name: new RegExp(`Features of ${fieldLabel}$`) }).click()
  const box = page.getByRole('checkbox', { name: new RegExp(`^${tick}`) })
  if (on) await box.check()
  else await box.uncheck()
  await page.keyboard.press('Escape')
}

const wideBar = (page: Page) => page.getByRole('group', { name: 'Table-wide switches for Candidate' })

/** Set one table-wide switch in the bar over the Fields grid and wait until it is saved. */
export async function setTableWide(page: Page, name: string, on: boolean) {
  await page.goto('/studio?tab=data&table=candidate')
  const sw = wideBar(page).getByRole('switch', { name: new RegExp(`^${name}`) })
  await expect(sw).toBeVisible()
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', String(on))
}

/** Read one tick of a field's Features cell. */
export async function expectFieldFeature(page: Page, fieldLabel: string, tick: string, on: boolean) {
  await page.getByRole('button', { name: new RegExp(`Features of ${fieldLabel}$`) }).click()
  const box = page.getByRole('checkbox', { name: new RegExp(`^${tick}`) })
  if (on) await expect(box).toBeChecked()
  else await expect(box).not.toBeChecked()
  await page.keyboard.press('Escape')
}

/** Run an action that changes a table-wide setting and wait until the Draft has saved it. */
export async function featuresSaved<T>(page: Page, action: () => Promise<T>): Promise<T> {
  const [, result] = await Promise.all([
    page.waitForResponse((r) => /\/v1\/studio\/tables\/[^/]+\/features$/.test(r.url()) && r.request().method() === 'PUT'),
    action(),
  ])
  return result
}
