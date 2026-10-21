import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TrendChart, formatValue } from './charts'

describe('formatValue', () => {
  it('groups digits the Indian way and says when there is no data', () => {
    expect(formatValue(1234567)).toBe('12,34,567')
    expect(formatValue(null)).toBe('No data')
  })
})

describe('TrendChart', () => {
  const series = [
    { label: '2026-10-05', value: 2 },
    { label: '2026-10-12', value: 0 },
    { label: '2026-10-19', value: 5 },
  ]
  it('describes itself in words and offers a table of the same numbers', async () => {
    render(<TrendChart label="Submissions" series={series} unit="week" />)
    expect(screen.getByRole('img', { name: /Submissions: 7 in total over 3 weeks\. Highest 5\./ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const table = screen.getByRole('table', { name: 'Submissions by week' })
    expect(table).toHaveTextContent('5')
    expect(screen.getByRole('button', { name: 'Show chart' })).toHaveAttribute('aria-pressed', 'true')
  })
})
