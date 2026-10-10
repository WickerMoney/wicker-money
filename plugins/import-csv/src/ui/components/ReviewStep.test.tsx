import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AnalyzeResult, AnalyzedRow } from '../models/index.js'
import { REVIEW_PAGE_SIZE } from './REVIEW_PAGE_SIZE.js'
import { ReviewStep } from './ReviewStep.js'

function flaggedRow(n: number): AnalyzedRow {
  return {
    rowNumber: n + 2, date: '2026-03-04', merchant: `SHOP ${n}`, amount: '-1.00', notes: null,
    externalId: null, status: 'needs-review', reason: 'looks like SHOP', matched: null,
  }
}

function analysisWith(flagged: number): AnalyzeResult {
  return {
    summary: { total: flagged, new: 0, duplicate: 0, needsReview: flagged, errors: 0 },
    rows: Array.from({ length: flagged }, (_, i) => flaggedRow(i)),
    errors: [],
  }
}

function renderReview(flagged: number) {
  const view = render(
    <ReviewStep
      analysis={analysisWith(flagged)}
      accepted={new Set()}
      onAccepted={() => undefined}
      formatMoney={(v) => v}
      busy={false}
      onCommit={() => undefined}
    />,
  )
  return view
}

/**
 * Counts the row checkboxes with a plain DOM query. `getAllByRole` computes the
 * accessible role of every element and is far too slow for a few hundred rows
 * in jsdom (seconds per call, which timed out under CI load).
 */
const dataRows = (container: HTMLElement) =>
  container.querySelectorAll('input[type="checkbox"]').length

describe('ReviewStep flagged list', () => {
  it('renders every row of a short list with no "show more"', () => {
    const { container } = renderReview(5)
    expect(dataRows(container)).toBe(5)
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })

  it('renders only the first page of a long list', () => {
    const { container } = renderReview(2_000)
    expect(dataRows(container)).toBe(REVIEW_PAGE_SIZE)
    expect(screen.getByText(`Showing ${REVIEW_PAGE_SIZE} of 2000 possible duplicates.`)).toBeTruthy()
  })

  it('reveals another page at a time', () => {
    const { container } = renderReview(250)
    fireEvent.click(screen.getByText(`Show ${REVIEW_PAGE_SIZE} more`))
    expect(dataRows(container)).toBe(REVIEW_PAGE_SIZE * 2)
    fireEvent.click(screen.getByText('Show 50 more'))
    expect(dataRows(container)).toBe(250)
    expect(screen.queryByText(/Show \d+ more/)).toBeNull()
  })
})
