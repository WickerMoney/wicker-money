import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AnalyzeResult, AnalyzedRow } from '../models/index.js'
import { REVIEW_PAGE_SIZE } from './REVIEW_PAGE_SIZE.js'
import { ReviewStep } from './ReviewStep.js'

function flaggedRow(n: number): AnalyzedRow {
  return {
    rowNumber: n + 2, date: '2026-03-04', merchant: `SHOP ${n}`, amount: '-1.00', notes: null,
    externalId: null, status: 'needs-review', reason: 'looks like SHOP', matched: null,
  }
}

/** An analysis whose file has `total` possible duplicates, `loaded` of which the server has sent so far. */
function analysisWith(total: number, loaded = total, newRows = 0): AnalyzeResult {
  const rows = Array.from({ length: loaded }, (_, i) => flaggedRow(i))
  return {
    summary: { total: total + newRows, new: newRows, duplicate: 0, needsReview: total, errors: 0 },
    rows: rows.slice(0, 100),
    flagged: { total, offset: 0, rows },
    errors: [],
  }
}

function renderReview(
  total: number,
  { loaded = total, onLoadMore = async () => true, onCommit = () => undefined, newRows = 0 } = {},
) {
  return render(
    <ReviewStep
      analysis={analysisWith(total, loaded, newRows)}
      accepted={new Set()}
      onAccepted={() => undefined}
      formatMoney={(v) => v}
      busy={false}
      onLoadMore={onLoadMore}
      onCommit={onCommit}
    />,
  )
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

describe('ReviewStep paging from the server', () => {
  it('shows the true total while only the loaded rows are listed', () => {
    const { container } = renderReview(1_200, { loaded: 500 })
    expect(dataRows(container)).toBe(REVIEW_PAGE_SIZE)
    expect(screen.getByText(`Showing ${REVIEW_PAGE_SIZE} of 1200 possible duplicates.`)).toBeTruthy()
  })

  it('reveals loaded rows without asking the server', () => {
    const onLoadMore = vi.fn(async () => true)
    const { container } = renderReview(1_200, { loaded: 500, onLoadMore })
    fireEvent.click(screen.getByText(`Show ${REVIEW_PAGE_SIZE} more`))
    expect(dataRows(container)).toBe(REVIEW_PAGE_SIZE * 2)
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('asks the server for the next page when the loaded rows run out, then shows more', async () => {
    // 150 loaded of 300: the second click needs rows 151-200, which are not here yet.
    let loaded = 150
    const onLoadMore = vi.fn(async () => { loaded = 300; return true })
    const { container, rerender } = renderReview(300, { loaded, onLoadMore })
    fireEvent.click(screen.getByText(`Show ${REVIEW_PAGE_SIZE} more`)) // 200 wanted, 150 loaded
    await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1))
    rerender(
      <ReviewStep
        analysis={analysisWith(300, 300)} accepted={new Set()} onAccepted={() => undefined}
        formatMoney={(v) => v} busy={false} onLoadMore={onLoadMore} onCommit={() => undefined}
      />,
    )
    await waitFor(() => expect(dataRows(container)).toBe(200))
  })

  it('shows nothing more, and leaves the button, when the next page cannot be loaded', async () => {
    const onLoadMore = vi.fn(async () => false)
    const { container } = renderReview(300, { loaded: 100, onLoadMore })
    fireEvent.click(screen.getByText(`Show ${REVIEW_PAGE_SIZE} more`))
    await waitFor(() => expect(onLoadMore).toHaveBeenCalled())
    expect(dataRows(container)).toBe(100)
    expect(screen.getByText(`Show ${REVIEW_PAGE_SIZE} more`)).toBeTruthy()
  })

  it('counts what will be imported from the summary, not from the rows on screen', () => {
    // 5,000 new rows were never listed; the button must still say what the commit will do.
    renderReview(300, { loaded: 100, newRows: 5_000 })
    expect(screen.getByText('Import 5000 transactions')).toBeTruthy()
  })
})
