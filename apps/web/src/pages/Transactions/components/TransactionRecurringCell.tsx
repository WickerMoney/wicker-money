import { memo } from 'react'
import { Button } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { Transaction } from '../../../models/index.js'
import { dayDifferenceText } from '../../Recurring/helpers/occurrenceLabels.js'
import type { TransactionMatches } from '../hooks/useTransactionMatches.js'

/** Props for {@link TransactionRecurringCell}. */
export interface TransactionRecurringCellProps {
  /** The row. */
  readonly transaction: Transaction
  /** Matching state for the rows on screen. */
  readonly matches: TransactionMatches
  /** `true` while a request is in flight; disables the buttons. */
  readonly busy: boolean
}

/**
 * A row's recurring item: the occurrence it settles (with Unmatch), or the
 * one suggested for it (Match, or Not this), plus any it was dismissed for
 * (with Undo). "Other" lists every occurrence it could settle, to pick a
 * different one. Nothing is matched without a click. Memoized: `matches` keeps
 * its identity until the matching state changes.
 */
export const TransactionRecurringCell = memo(function TransactionRecurringCell(
  { transaction: t, matches, busy }: TransactionRecurringCellProps,
) {
  const summary = matches.byId.get(t.id)
  const picker = matches.picker?.transactionId === t.id ? matches.picker : null
  const linked = summary?.linked ?? null
  const suggestion = linked === null ? summary?.suggestion ?? null : null

  return (
    <div className="txn-recur">
      {linked !== null ? (
        <div>
          <span className="recur-status recur-status--good">{linked.name}</span>{' '}
          <span className="wm-muted recur-sub">{formatDate(linked.nominalDate)}</span>{' '}
          <button type="button" className="recur-link" disabled={busy}
                  aria-label={`Unmatch ${t.merchant} from ${linked.name}`}
                  onClick={() => void matches.unmatch(t, linked)}>Unmatch</button>
        </div>
      ) : suggestion !== null ? (
        <div className="txn-recur__suggestion">
          <span className="recur-sub">
            Looks like <strong>{suggestion.occurrence.name}</strong>
            <span className="wm-muted"> {formatDate(suggestion.occurrence.expectedDate)}</span>
          </span>
          <div className="recur-actions txn-recur__actions">
            <Button variant="primary" disabled={busy} aria-label={`Match ${t.merchant} to ${suggestion.occurrence.name}`}
                    onClick={() => void matches.confirm(t, suggestion)}>Match</Button>
            <Button disabled={busy} aria-label={`${t.merchant} is not ${suggestion.occurrence.name}`}
                    onClick={() => void matches.dismiss(t, suggestion.occurrence)}>Not this</Button>
            {picker === null ? (
              <button type="button" className="recur-link" disabled={busy}
                      aria-label={`Other recurring items for ${t.merchant}`}
                      onClick={() => void matches.openPicker(t)}>Other</button>
            ) : null}
          </div>
        </div>
      ) : picker === null ? (
        <button type="button" className="recur-link txn-recur__find" disabled={busy}
                aria-label={`Match ${t.merchant} to a recurring item`}
                onClick={() => void matches.openPicker(t)}>Match…</button>
      ) : null}

      {(summary?.dismissed ?? []).map((o) => (
        <div key={`${o.itemId}:${o.nominalDate}`} className="wm-muted recur-sub">
          Not {o.name} ({formatDate(o.nominalDate)}){' '}
          <button type="button" className="recur-link" disabled={busy}
                  aria-label={`Undo: ${t.merchant} is not ${o.name}`}
                  onClick={() => void matches.undismiss(t, o)}>Undo</button>
        </div>
      ))}

      {picker !== null ? (
        <div className="recur-candidates txn-recur__picker">
          {picker.candidates.length === 0 ? (
            <p className="wm-muted recur-sub">No recurring item expects this within 10 days of {formatDate(t.transaction_date)}.</p>
          ) : (
            <ul aria-label={`Recurring items ${t.merchant} could be`}>
              {picker.candidates.map((c) => (
                <li key={`${c.occurrence.itemId}:${c.occurrence.nominalDate}`} className="recur-candidate">
                  <span>
                    <strong>{c.occurrence.name}</strong>, {formatDate(c.occurrence.expectedDate)}
                    <span className="wm-muted">
                      {' '}{formatMoney(c.occurrence.legs.find((l) => l.accountId === c.accountId)?.amount ?? c.occurrence.amount)} expected,
                      {' '}{dayDifferenceText(c.candidate.dayDifference)}
                      {c.dismissed ? ', dismissed' : ''}
                    </span>
                  </span>
                  <Button disabled={busy} aria-label={`Match to ${c.occurrence.name} ${c.occurrence.nominalDate}`}
                          onClick={() => void matches.match(t, c.occurrence)}>Match</Button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="recur-link" onClick={matches.closePicker}>Close</button>
        </div>
      ) : null}
    </div>
  )
})
