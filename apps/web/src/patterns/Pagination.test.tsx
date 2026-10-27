import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import { describe, expect, it, vi } from 'vitest'
import { Pagination, pageWindow } from './Pagination'
import { readPrefs } from './useTablePrefs'

describe('page window', () => {
  it('shows the ends and the neighbours with gaps between', () => {
    expect(pageWindow(1, 1)).toEqual([1])
    expect(pageWindow(1, 5)).toEqual([1, 2, null, 5])
    expect(pageWindow(5, 10)).toEqual([1, null, 4, 5, 6, null, 10])
    expect(pageWindow(10, 10)).toEqual([1, null, 9, 10])
    expect(pageWindow(2, 3)).toEqual([1, 2, 3])
  })
})

describe('Pagination', () => {
  it('says which rows are shown and moves between pages', async () => {
    const onPage = vi.fn()
    const { container } = render(<Pagination total={312} page={2} pageSize={25} onPage={onPage} onPageSize={() => {}} noun="candidates" />)
    expect(screen.getByTestId('page-range')).toHaveTextContent('Showing 26 to 50 of 312 candidates')
    expect(screen.getByRole('button', { name: 'Page 2' })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(onPage).toHaveBeenCalledWith(3)
    await userEvent.click(screen.getByRole('button', { name: 'Last page' }))
    expect(onPage).toHaveBeenCalledWith(13)
    expect(await axe(container)).toHaveNoViolations()
  })
  it('disables first and previous on page one, and handles no rows', () => {
    render(<Pagination total={0} page={1} pageSize={25} onPage={() => {}} onPageSize={() => {}} noun="candidates" />)
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    expect(screen.getByTestId('page-range')).toHaveTextContent('Showing 0 to 0 of 0')
  })
})

describe('table preferences', () => {
  it('fall back to defaults and ignore bad saved values', () => {
    localStorage.clear()
    expect(readPrefs('t')).toEqual({ density: null, hidden: [], added: [], pageSize: 25 })
    localStorage.setItem('tableui.table.t', JSON.stringify({ density: 'weird', hidden: ['a', 3], pageSize: 7 }))
    expect(readPrefs('t')).toEqual({ density: null, hidden: ['a'], added: [], pageSize: 25 })
    localStorage.setItem('tableui.table.t', '{not json')
    expect(readPrefs('t').density).toBeNull()
  })
})
