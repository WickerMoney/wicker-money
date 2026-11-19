import { Button, Surface } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { DismissedSuggestion, MatchSuggestion, RecurringItem } from '../../../models/index.js'
import { attentionRows } from '../helpers/attentionRows.js'
import { dayDifferenceText } from '../helpers/occurrenceLabels.js'
import { AttentionList } from './AttentionList.js'
import { DismissedList } from './DismissedList.js'

/** Props for {@link SuggestionsPanel}. */
export interface SuggestionsPanelProps {
  readonly suggestions: readonly MatchSuggestion[]
  /** The page's recurring items: their late and missed occurrences are listed. */
  readonly items: readonly RecurringItem[]
  /** The server's today. */
  readonly today: string
  /**
   * Whether the suggestions have loaded. The late and missed list waits for
   * them, because it leaves out what is already suggested.
   */
  readonly suggestionsLoaded: boolean
  /** Dismissed suggestions that can still be undone. */
  readonly dismissed?: readonly DismissedSuggestion[]
  readonly currency: string
  readonly accountName: (id: string) => string
  readonly busy: boolean
  readonly onConfirm: (suggestion: MatchSuggestion) => void
  /** Opens an item's occurrences to find the payment for one that is late or missed. */
  readonly onFindPayment: (item: RecurringItem) => void
  readonly onDismiss?: (suggestion: MatchSuggestion) => void
  readonly onUndismiss?: (dismissed: DismissedSuggestion) => void
}

/**
 * What still needs a payment found, in the order to deal with it: transactions
 * that look like a recent occurrence's payment, waiting for a click; then the
 * late and missed occurrences nothing has been matched to (a payment can clear
 * long after its due date); then, folded away, the suggestions that were
 * dismissed, so a misclick can be undone. Confirming a match tells the
 * forecast and "Until payday" the money has landed, so it is not counted
 * again. Nothing here is matched on its own. Hidden when there is nothing to
 * show.
 */
export function SuggestionsPanel({
  suggestions, items, today, suggestionsLoaded, dismissed = [], currency, accountName, busy, onConfirm, onFindPayment, onDismiss, onUndismiss,
}: SuggestionsPanelProps) {
  const attention = suggestionsLoaded ? attentionRows(items, today, suggestions) : []
  if (suggestions.length === 0 && attention.length === 0 && dismissed.length === 0) return null
  return (
    <Surface title="Did these land?">
      {suggestions.length > 0 ? (
        <>
          <p className="wm-muted recur-sub">
            These transactions look like recurring items. Confirm a match and it stops being counted as still to come.
          </p>
          <ul className="recur-suggestions">
            {suggestions.map((s) => {
              const leg = s.occurrence.legs.find((l) => l.accountId === s.accountId)
              return (
                <li key={`${s.occurrence.itemId}:${s.occurrence.nominalDate}:${s.accountId}`} className="recur-suggestion">
                  <div>
                    <div>
                      <strong>{s.occurrence.name}</strong>
                      <span className="wm-muted"> expected {formatDate(s.occurrence.expectedDate)}</span>
                      {leg !== undefined ? <span className="wm-muted">, {formatMoney(leg.amount, currency)} in {accountName(s.accountId)}</span> : null}
                    </div>
                    <div className="wm-muted recur-sub">
                      {s.candidate.merchant}, {formatDate(s.candidate.date)} ({dayDifferenceText(s.candidate.dayDifference)}),{' '}
                      {formatMoney(s.candidate.amount, currency)}
                    </div>
                  </div>
                  <div className="recur-actions">
                    {onDismiss !== undefined
                      ? <Button busy={busy} onClick={() => onDismiss(s)} aria-label={`Not ${s.occurrence.name}: ${s.candidate.merchant}`}>Not this</Button>
                      : null}
                    <Button variant="primary" busy={busy} onClick={() => onConfirm(s)}>Match</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      <AttentionList rows={attention} currency={currency} busy={busy} onFindPayment={onFindPayment} />
      <DismissedList dismissed={dismissed} currency={currency} busy={busy} onUndismiss={onUndismiss} />
    </Surface>
  )
}
