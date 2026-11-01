import { expect, test } from '@playwright/test'
import { run, signUpWithPack } from './helpers'
import { freshSession, publishLive } from './live-effect'

/** S1 of the Studio table redesign: the inline-editable Fields grid (mockup board 1). */

test('S1.2 inline label: Enter saves, Esc cancels, leaving the cell saves, bad labels are refused', async ({ page }) => {
  await signUpWithPack(page, `S1 Co ${run}`, `s1a-${run}@studio.test`)
  await page.goto('/studio')
  const row = (key: string) => page.getByRole('row', { name: new RegExp(`^(?:Move [^.]*\\. Drag, or use the up and down arrow keys\\. )?${key} `) })
  const rename = (key: string, label: string) => row(key).getByRole('button', { name: label, exact: true })

  await test.step('Enter saves the new label to the Draft', async () => {
    await rename('full_name', 'Full name').click()
    const input = page.getByLabel('Label of full_name')
    await input.fill('Candidate name')
    await input.press('Enter')
    await expect(row('full_name')).toContainText('Candidate name')
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
  })

  await test.step('Esc cancels and keeps the old label', async () => {
    await rename('email', 'Email').click()
    const input = page.getByLabel('Label of email')
    await input.fill('Mail address')
    await input.press('Escape')
    await expect(row('email')).toContainText('Email')
    await expect(row('email')).not.toContainText('Mail address')
  })

  await test.step('Leaving the cell saves', async () => {
    await rename('email', 'Email').click()
    await page.getByLabel('Label of email').fill('E-mail')
    await page.locator('body').click({ position: { x: 3, y: 3 } })
    await expect(row('email')).toContainText('E-mail')
  })

  await test.step('An empty label is refused and nothing is saved', async () => {
    await rename('email', 'E-mail').click()
    const input = page.getByLabel('Label of email')
    await input.fill('   ')
    await input.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'A label is required.' })).toBeVisible()
    await input.press('Escape')
    await expect(row('email')).toContainText('E-mail')
  })

  await test.step('A label another field already uses is refused', async () => {
    await rename('email', 'E-mail').click()
    const input = page.getByLabel('Label of email')
    await input.fill('candidate name')
    await input.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'already called' })).toBeVisible()
    await input.press('Escape')
    await expect(row('email')).toContainText('E-mail')
  })
})

test('S1 live effect: a label renamed in Studio shows on the live form and list', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Live ${run}`, `s1b-${run}@studio.test`)
  await page.goto('/studio')
  await page.getByRole('row', { name: /^(?:Move [^.]*\. Drag, or use the up and down arrow keys\. )?full_name / }).getByRole('button', { name: 'Full name', exact: true }).click()
  await page.getByLabel('Label of full_name').fill('Candidate name')
  await page.getByLabel('Label of full_name').press('Enter')
  await expect(page.getByRole('row', { name: /^(?:Move [^.]*\. Drag, or use the up and down arrow keys\. )?full_name / })).toContainText('Candidate name')
  await publishLive(page)

  const live = await freshSession(browser, page)
  await live.goto('/records/candidate/new')
  await expect(live.getByLabel(/^Candidate name/)).toBeVisible()
  await live.getByLabel(/^Candidate name/).fill('Live Rename Check')
  await live.getByLabel(/^Email/).fill(`live-${run}@rename.test`)
  await live.getByLabel(/^Phone/).fill('+91 98450 77777')
  await live.getByRole('button', { name: 'Save candidate' }).click()
  await expect(live.getByRole('heading', { name: 'Live Rename Check' }).first()).toBeVisible()
  await live.goto('/records/candidate')
  await expect(live.getByRole('columnheader', { name: /Candidate name/ })).toBeVisible()
  await live.context().close()
})

test('S1.3 required switch: one click saves to the Draft, and the live form then requires the value', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Req ${run}`, `s1c-${run}@studio.test`)
  await page.goto('/studio')
  const sw = page.getByRole('switch', { name: 'Current employer is required' })

  await test.step('The switch starts off, turns on with one click and survives a reload', async () => {
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
    await page.reload()
    await expect(page.getByRole('switch', { name: 'Current employer is required' })).toHaveAttribute('aria-checked', 'true')
  })

  await test.step('It works from the keyboard and turns off again', async () => {
    const again = page.getByRole('switch', { name: 'Current employer is required' })
    await again.focus()
    await page.keyboard.press('Space')
    await expect(again).toHaveAttribute('aria-checked', 'false')
    await expect(again).not.toHaveAttribute('aria-busy', 'true')
    await again.press('Space')
    await expect(again).toHaveAttribute('aria-checked', 'true')
  })

  await test.step('After publishing, a separate session cannot save the form without it', async () => {
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await live.getByLabel(/Full name/).fill('Needs Employer')
    await live.getByLabel(/^Email/).fill(`req-${run}@x.test`)
    await live.getByLabel(/^Phone/).fill('+91 98450 66666')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('Current employer is required')).toBeVisible()
    await live.context().close()
  })
})

test('S1.4 reorder: drag and keyboard moves save the order, and the live form follows it', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Ord ${run}`, `s1d-${run}@studio.test`)
  await page.goto('/studio')
  const names = async () => (await page.locator('tbody tr td:nth-child(2)').allTextContents()).map((t) => t.trim())
  const handle = (label: string) => page.getByRole('button', { name: new RegExp(`^Move ${label}\\.`) })

  await test.step('Arrow Down on the handle moves the field one place and keeps focus', async () => {
    await expect(handle('Email')).toBeVisible()
    const before = await names()
    expect(before.indexOf('email')).toBeGreaterThanOrEqual(0)
    await handle('Email').focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(async () => (await names()).indexOf('email')).toBe(before.indexOf('email') + 1)
    await expect(handle('Email')).toBeFocused()
    await expect(page.getByText(/^Email moved to position/)).toBeAttached()
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
  })

  await test.step('Dragging a field onto another puts it there', async () => {
    const before = await names()
    await handle('Phone').dragTo(page.getByRole('row', { name: /^(?:Move [^.]*\. Drag, or use the up and down arrow keys\. )?full_name / }))
    await expect.poll(async () => (await names()).indexOf('phone')).toBe(before.indexOf('full_name'))
  })

  await test.step('The order survives a reload', async () => {
    const order = await names()
    await page.reload()
    await expect.poll(names).toEqual(order)
  })

  await test.step('After publishing, a separate session sees the same order on the form', async () => {
    const order = await names()
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    const email = await live.getByLabel(/^Email/).boundingBox()
    const phone = await live.getByLabel(/^Phone/).boundingBox()
    // email and phone share the Contact group; the Draft order decides which comes first.
    const emailFirst = order.indexOf('email') < order.indexOf('phone')
    expect(email && phone).toBeTruthy()
    expect(email!.y < phone!.y).toBe(emailFirst)
    await live.context().close()
  })
})

test('S1.5 a pack field is deleted like any other, and the live form no longer asks for it', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Pack ${run}`, `s1e-${run}@studio.test`)
  await page.goto('/studio')
  await page.getByRole('button', { name: 'Edit Notice period (days)' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).not.toContainText('comes with the pack')
  await dialog.getByRole('button', { name: 'Delete field' }).click()
  await expect(page.getByRole('row', { name: /notice_period_days/ })).toContainText('Deleted in the Draft')
  await publishLive(page)
  const live = await freshSession(browser, page)
  await live.goto('/records/candidate/new')
  await expect(live.getByLabel(/^Full name/)).toBeVisible()
  await expect(live.getByLabel(/^Notice period/)).toHaveCount(0)
  await live.context().close()
})

test('S1.6 a deleted field stays as a struck row with Undo until it is published', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Undo ${run}`, `s1f-${run}@studio.test`)
  await page.goto('/studio')
  await page.getByRole('switch', { name: 'Current employer is required' }).click() // something to publish
  await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
  await publishLive(page)
  await page.goto('/studio')

  await test.step('Deleting shows a removed row with Undo, and the live form still has the field', async () => {
    await page.getByRole('button', { name: 'Edit Notice period (days)' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete field' }).click()
    const removed = page.getByRole('row', { name: /notice_period_days/ })
    await expect(removed).toContainText('Deleted in the Draft')
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await expect(live.getByLabel(/^Notice period/)).toBeVisible()
    await live.context().close()
  })

  await test.step('Undo puts the field back in the grid and the Draft has no pending change for it', async () => {
    await page.getByRole('button', { name: 'Undo delete of Notice period (days)' }).click()
    await expect(page.locator('tr[data-stage="removed"]')).toHaveCount(0)
    await expect(page.getByRole('row', { name: /notice_period_days/ })).toHaveCount(1)
    await expect(page.getByRole('switch', { name: 'Notice period (days) is required' })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('button', { name: 'Edit Notice period (days)' })).toBeVisible()
  })
})

test('S1.7 row menu and details panel: help text, choices and hide all save to the Draft and reach the live form', async ({ page, browser }) => {
  await signUpWithPack(page, `S1 Det ${run}`, `s1g-${run}@studio.test`)
  await page.goto('/studio')
  const menu = (label: string) => page.getByRole('button', { name: `More actions for ${label}` })

  await test.step('Show details opens the panel under the row', async () => {
    await menu('Source').click()
    await page.getByRole('menuitem', { name: 'Show details' }).click()
    await expect(page.getByTestId('details-source')).toBeVisible()
    await expect(page.getByLabel('Choices of Source')).toBeVisible()
  })

  await test.step('Help text saves on Enter; a choice is added, moved and a duplicate is refused', async () => {
    const help = page.getByTestId('details-source').getByLabel('Help text')
    await help.fill('Where we first found this person')
    await help.press('Enter')
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
    const add = page.getByLabel('Add a choice to Source')
    await add.fill('Campus drive')
    await add.press('Enter')
    await expect(page.getByLabel('Choices of Source').getByText('Campus drive')).toBeVisible()
    await add.fill('campus drive')
    await add.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'already a choice' })).toBeVisible()
    await page.getByRole('button', { name: 'Move Campus drive earlier' }).click()
    await expect(page.getByRole('button', { name: 'Move Campus drive later' })).toBeEnabled()
  })

  await test.step('Hide from screens is in the menu and marks the row Hidden', async () => {
    await menu('Location').click()
    await page.getByRole('menuitem', { name: 'Hide from screens' }).click()
    await expect(page.getByRole('row', { name: /^(?:Move [^.]*\. Drag, or use the up and down arrow keys\. )?location / })).toContainText('Hidden')
  })

  await test.step('Edit details opens the full editor', async () => {
    await menu('Phone').click()
    await page.getByRole('menuitem', { name: 'Edit details' }).click()
    await expect(page.getByRole('dialog')).toContainText('Edit Phone')
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('After publishing, the live form shows the help text and the new choice, and no Location', async () => {
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await expect(live.getByText('Where we first found this person')).toBeVisible()
    await expect(live.getByLabel(/^Location/)).toHaveCount(0)
    await expect(live.getByLabel(/^Source/).locator('option', { hasText: 'Campus drive' })).toHaveCount(1)
    await live.context().close()
  })
})

test('S2.3 type picker: search, keyboard, blocked options explain themselves, and the chosen type reaches the live form', async ({ page, browser }) => {
  await signUpWithPack(page, `S2 Typ ${run}`, `s2a-${run}@studio.test`)
  await page.goto('/studio')
  const typeBtn = (label: string) => page.getByRole('button', { name: new RegExp(`^Type of ${label}:`) })
  const picker = page.getByRole('dialog', { name: 'Type picker' })

  await test.step('The picker opens on the field type with the groups and the right pane', async () => {
    await typeBtn('Current title').click()
    await expect(picker).toBeVisible()
    await expect(picker.getByRole('group', { name: 'Commonly used' })).toBeVisible()
    await expect(picker.getByRole('group', { name: 'Recruitment' })).toBeVisible()
    await expect(picker.getByText('What it sets for you')).toBeVisible()
  })

  await test.step('Search narrows the list; Enter on a compatible choice uses it', async () => {
    const search = picker.getByLabel('Search types')
    await search.fill('pan')
    await expect(picker.getByRole('option', { name: /PAN \(India\)/ })).toBeVisible()
    await expect(picker.getByRole('option', { name: /Whole number/ })).toHaveCount(0)
    await picker.getByRole('option', { name: /PAN \(India\)/ }).click()
    await expect(picker.getByText('Capital letters')).toBeVisible()
    await search.press('Enter')
    await expect(picker).toHaveCount(0)
    const row = page.getByRole('row', { name: /^(?:Move [^.]*\. Drag, or use the up and down arrow keys\. )?current_title /})
    await expect(row).toContainText('PAN (India)')
    await expect(row.locator('code')).toHaveText('text')
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
  })

  await test.step('An incompatible type is shown disabled with the reason and an Add a new field button', async () => {
    await typeBtn('Notice period \\(days\\)').click()
    await picker.getByRole('option', { name: /^Date/ }).click({ force: true }) // disabled options stay clickable so the reason can be read
    await expect(picker.getByRole('button', { name: /^Use / })).toBeDisabled()
    await expect(picker.getByText(/Cannot use this type here/)).toBeVisible()
    await picker.getByRole('button', { name: 'Add a new field' }).click()
    await expect(page.getByRole('dialog')).toContainText('Add a field to Candidate')
    await page.getByRole('button', { name: 'Cancel' }).click()
  })

  await test.step('Whole number can become a number with decimals', async () => {
    await typeBtn('Notice period \\(days\\)').click()
    await picker.getByRole('option', { name: /Number with decimals/ }).click()
    await picker.getByRole('button', { name: /^Use / }).click()
    const row = page.getByRole('row', { name: /^(?:Move [^.]*\. Drag, or use the up and down arrow keys\. )?notice_period_days /})
    await expect(row.locator('code')).toHaveText('decimal')
  })

  await test.step('After publishing, the live form saves capitals and stops values longer than 10', async () => {
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await live.getByLabel(/^Full name/).fill('Capital Check')
    await live.getByLabel(/^Email/).fill(`s2-${run}@pan.test`)
    await live.getByLabel(/^Phone/).fill('+91 98450 55555')
    await live.getByLabel(/^Current title/).fill('abcde1234fg')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText(/at most 10 characters/)).toBeVisible()
    await live.getByLabel(/^Current title/).fill('abcde1234f')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText('ABCDE1234F').first()).toBeVisible()
    await live.context().close()
  })
})

test('S2.4 length column: edit with Enter, cancel with Esc, dash for other types, and the live form enforces it', async ({ page, browser }) => {
  await signUpWithPack(page, `S2 Len ${run}`, `s2l-${run}@studio.test`)
  await page.goto('/studio')
  const row = (key: string) => page.getByRole('row', { name: new RegExp(`^(?:Move [^.]*\\. Drag, or use the up and down arrow keys\\. )?${key} `) })
  const lenBtn = page.getByRole('button', { name: /^Maximum length of Current title:/ })

  await test.step('Non text types show a dash; text types show their limit', async () => {
    await expect(row('notice_period_days').getByLabel('Notice period (days) has no length')).toBeVisible()
    await expect(lenBtn).toBeVisible()
  })

  await test.step('Esc cancels, a bad value is refused, Enter saves', async () => {
    await lenBtn.click()
    const input = page.getByLabel('Maximum length of current_title')
    await input.fill('7')
    await input.press('Escape')
    await expect(input).toHaveCount(0)
    await expect(page.getByTestId('draft-banner')).toHaveCount(0)
    await lenBtn.click()
    await input.fill('0')
    await input.press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'whole number' })).toBeVisible()
    await input.fill('12')
    await input.press('Enter')
    await expect(page.getByRole('button', { name: 'Maximum length of Current title: 12' })).toBeVisible()
    await expect(page.getByTestId('draft-banner')).toContainText('unpublished change')
  })

  await test.step('After publishing, the live form stops values longer than 12', async () => {
    await publishLive(page)
    const live = await freshSession(browser, page)
    await live.goto('/records/candidate/new')
    await live.getByLabel(/^Full name/).fill('Length Check')
    await live.getByLabel(/^Email/).fill(`s2l-${run}@len.test`)
    await live.getByLabel(/^Phone/).fill('+91 98450 55555')
    await live.getByLabel(/^Current title/).fill('1234567890123')
    await live.getByRole('button', { name: 'Save candidate' }).click()
    await expect(live.getByText(/at most 12 characters/)).toBeVisible()
    await live.context().close()
  })

  await page.goto('/studio')
  await expect(page.getByRole('button', { name: 'Maximum length of Current title: 12' })).toBeVisible()
  await page.screenshot({ path: '../../docs/screens/studio-table/s2/after-length.png' })
})
