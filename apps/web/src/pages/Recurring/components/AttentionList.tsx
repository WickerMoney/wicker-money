import { Button } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { RecurringItem } from '../../../models/index.js'
import type { AttentionRow } from '../helpers/attentionRows.js'
import { dayDifferenceText } from '../helpers/occurrenceLabels.js'

/** Props for {@link AttentionList}. */
export interface AttentionListProps {
  readonly rows: readonly AttentionRow[]
  readonly currency: string
  readonly busy: boolean
  /** Opens the item's occurrences, where its payment can be found and matched. */
  readonly onFindPayment: (item: RecurringItem) => void
}

/**
 * Occurrences that were expected and have not been matched to a payment:
 * late ones (still counted as coming) and missed ones (a week or more past,
 * no longer counted). Each opens the item's occurrences to find the payment,
 * which can clear well after the due date.
 */
export function AttentionList({ rows, currency, busy, onFindPayment }: AttentionListProps) {
  if (rows.length === 0) return null
  return (
    <div className="recur-attention">
      <p className="wm-muted recur-sub">Expected and not matched to a payment yet:</p>
      <ul className="recur-suggestions">
        {rows.map((r) => (
          <li key={`${r.item.id}:${r.nominalDate}`} className="recur-suggestion">
            <div>
              <div>
                <strong>{r.item.name}</strong>
                <span className="wm-muted"> expected {formatDate(r.nominalDate)}, {formatMoney(r.item.amount, currency)}</span>
              </div>
              <div className="recur-sub">
                <span className={`recur-status recur-status--${r.state === 'late' ? 'warn' : 'muted'}`}>
                  {r.state === 'late' ? 'Late' : 'Missed'}
                </span>{' '}
                <span className="wm-muted">{dayDifferenceText(r.daysLate)}</span>
              </div>
            </div>
            <div className="recur-actions">
              <Button busy={busy} onClick={() => onFindPayment(r.item)} aria-label={`Find payment for ${r.item.name}, expected ${formatDate(r.nominalDate)}`}>
                Find payment
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
