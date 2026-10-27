import { afterEach, describe, expect, it } from 'vitest'
import { monogram } from './AppShell'
import { nextSidebar, savedSidebar, SIDEBAR_KEY, startingSidebar } from './useSidebar'

afterEach(() => localStorage.clear())

describe('sidebar state', () => {
  it('steps full, rail, hidden, then back to full', () => {
    expect(nextSidebar('expanded')).toBe('collapsed')
    expect(nextSidebar('collapsed')).toBe('hidden')
    expect(nextSidebar('hidden')).toBe('expanded')
  })
  it('starts full on a wide screen, as a rail on a medium one, unless the person chose', () => {
    expect(startingSidebar(1440, null)).toBe('expanded')
    expect(startingSidebar(900, null)).toBe('collapsed')
    expect(startingSidebar(500, null)).toBe('expanded')
    expect(startingSidebar(900, 'expanded')).toBe('expanded')
    expect(startingSidebar(1440, 'hidden')).toBe('hidden')
  })
  it('reads only a known saved choice', () => {
    expect(savedSidebar()).toBeNull()
    localStorage.setItem(SIDEBAR_KEY, 'nonsense')
    expect(savedSidebar()).toBeNull()
    localStorage.setItem(SIDEBAR_KEY, 'collapsed')
    expect(savedSidebar()).toBe('collapsed')
  })
})

describe('rail monogram', () => {
  it('uses the first letters of the first two words, or the first two letters of one word', () => {
    expect(monogram('Job orders')).toBe('JO')
    expect(monogram('Candidates')).toBe('CA')
    expect(monogram('  ')).toBe('')
  })
})
