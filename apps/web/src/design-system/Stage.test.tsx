import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { describe, expect, it } from 'vitest'
import { STAGES, StageBadge, StageDot, stageStripe } from './Stage'
import { contrast } from './color'

const TOKENS: Record<string, [string, string]> = {
  draft: ['#92400e', '#fef3c7'],
  test: ['#075985', '#e0f2fe'],
  live: ['#166534', '#dcfce7'],
  removed: ['#475569', '#f1f5f9'],
}

describe('stage colours', () => {
  it('keeps the text of every stage at 4.5:1 or better on its own background', () => {
    for (const [ink, soft] of Object.values(TOKENS)) expect(contrast(ink, soft)).toBeGreaterThanOrEqual(4.5)
  })

  it('never relies on colour alone: each stage has a word, an icon and a meaning', () => {
    const words = Object.values(STAGES).map((s) => s.label)
    expect(new Set(words).size).toBe(4)
    for (const stage of Object.keys(STAGES) as (keyof typeof STAGES)[]) {
      const { container, unmount } = render(<StageBadge stage={stage} />)
      expect(container.querySelector('svg')).not.toBeNull()
      expect(screen.getByText(STAGES[stage].label)).toBeInTheDocument()
      expect(container.firstElementChild).toHaveAttribute('title', STAGES[stage].meaning)
      unmount()
    }
  })

  it('marks a new Draft item and no other', () => {
    const { rerender } = render(<StageBadge stage="draft" isNew />)
    expect(screen.getByText(/Draft · new/)).toBeInTheDocument()
    rerender(<StageBadge stage="test" isNew />)
    expect(screen.queryByText(/new/)).toBeNull()
  })

  it('gives a dot a text alternative and a stripe class per stage', () => {
    render(<StageDot stage="test" />)
    expect(screen.getByRole('img', { name: 'Test' })).toBeInTheDocument()
    expect(stageStripe('draft')).toContain('border-l-stage-draft')
    expect(stageStripe(undefined)).toBe('')
  })

  it('has no accessibility violations', async () => {
    const { container } = render(
      <div>
        {(Object.keys(STAGES) as (keyof typeof STAGES)[]).map((s) => <StageBadge key={s} stage={s} />)}
        <StageDot stage="live" />
      </div>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
