import { memo } from 'react'
import { formatDate } from '../../../lib/formatDate.js'
import type { Transaction } from '../../../models/index.js'
import type { TransactionMatches } from '../hooks/useTransactionMatches.js'

/** Props for {@link TransactionRecurringCell}. */
export interface TransactionRecurringCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** Matching state for the rows on screen. */
  readonly matches: TransactionMatches
  /** `true` while a request is in flight; disables the button. */
  readonly busy: boolean
}

/** The X drawn in the pill's remove button. */
const X = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)

/**
 * A row's recurring column: the occurrence it settles, as a pill with its own
 * remove (Unmatch) button, then the occurrence's date when that is not the
 * transaction's own. A row that settles nothing shows nothing here: choosing,
 * suggestions and dismissals are in the picker that the row's Link button opens
 * ({@link TransactionRecurringPicker}). Memoized: `matches` keeps its identity
 * until the matching state changes.
 */
export const TransactionRecurringCell = memo(function TransactionRecurringCell(
  { transaction: t, matches, busy }: TransactionRecurringCellProps,
) {
  const linked = matches.byId.get(t.id)?.linked ?? null
  if (linked === null) return null
  return (
    <div className="txn-recur">
      <div className="recur2__line">
        <span className={busy ? 'recur2__chip is-busy' : 'recur2__chip'} title={linked.name}>
          <span className="recur2__chip-name">{linked.name}</span>
          <button type="button" className="recur2__chip-x" disabled={busy}
                  aria-label={`Unmatch ${t.merchant} from ${linked.name}`}
                  onClick={() => void matches.unmatch(t, linked)}>{X}</button>
        </span>
        {linked.nominalDate !== t.transaction_date ? (
          <span className="wm-muted recur2__date">
            <span className="wm-visually-hidden">Occurrence date: </span>{formatDate(linked.nominalDate)}
          </span>
        ) : null}
      </div>
    </div>
  )
})
