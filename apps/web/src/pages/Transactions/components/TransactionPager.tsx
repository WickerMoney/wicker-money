import { Button, SelectField } from '@wickermoney/ui-kit'
import { PAGE_SIZES } from '../helpers/pageSizes.js'

/** Props for {@link TransactionPager}. */
export interface TransactionPagerProps {
  /** Number of matching transactions across all pages, or `null` until it is known. */
  readonly total: number | null
  /** Page size. */
  readonly limit: number
  /** One-based number of the page being shown. */
  readonly pageNumber: number
  /** Whether there is an earlier page. */
  readonly hasPrevious: boolean
  /** Whether there is a later page. */
  readonly hasNext: boolean
  /** `true` while a request is in flight; disables the controls. */
  readonly busy: boolean
  /** Called with the newly chosen page size. */
  readonly onPageSizeChange: (size: number) => void
  /** Called to show the previous page. */
  readonly onPrevious: () => void
  /** Called to show the next page. */
  readonly onNext: () => void
}

/**
 * Previous/Next navigation and the "N transactions" count.
 *
 * Pages are reached one step at a time, because a page is found from the one
 * before it; there is no jumping to "page 12" or to the last page. The count is
 * the useful half: "Next" alone cannot say whether the end is three rows away or
 * three hundred.
 */
export function TransactionPager({
  total, limit, pageNumber, hasPrevious, hasNext, busy, onPageSizeChange, onPrevious, onNext,
}: TransactionPagerProps) {
  return (
    <div className="txn__pager">
      <span className="txn__count">
        {total === null ? '' : total === 0
          ? 'No transactions'
          : `${total.toLocaleString()} ${total === 1 ? 'transaction' : 'transactions'}`}
      </span>
      <div className="txn__pager-controls">
        <SelectField
          label="Per page"
          value={String(limit)}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
        </SelectField>
        <Button disabled={busy || !hasPrevious} onClick={onPrevious}>‹ Previous</Button>
        <span className="txn__page">Page {pageNumber}</span>
        <Button disabled={busy || !hasNext} onClick={onNext}>Next ›</Button>
      </div>
    </div>
  )
}
