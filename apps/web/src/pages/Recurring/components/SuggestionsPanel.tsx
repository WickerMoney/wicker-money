import { Button, Surface } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { DismissedSuggestion, MatchSuggestion } from '../../../models/index.js'
import { dayDifferenceText } from '../helpers/occurrenceLabels.js'

/** Props for {@link SuggestionsPanel}. */
export interface SuggestionsPanelProps {
  readonly suggestions: readonly MatchSuggestion[]
  /** Dismissed suggestions that can still be undone. */
  readonly dismissed?: readonly DismissedSuggestion[]
  readonly currency: string
  readonly accountName: (id: string) => string
  readonly busy: boolean
  readonly onConfirm: (suggestion: MatchSuggestion) => void
  readonly onDismiss?: (suggestion: MatchSuggestion) => void
  readonly onUndismiss?: (dismissed: DismissedSuggestion) => void
}

/**
 * Transactions that look like a recent occurrence's payment, waiting for a
 * click. Confirming one tells the forecast and "Until payday" the money has
 * landed, so it is not counted again; "Not this" stops that transaction
 * being offered for that occurrence. Nothing here is matched on its own.
 * Hidden when there is nothing to confirm or undo.
 */
export function SuggestionsPanel({
  suggestions, dismissed = [], currency, accountName, busy, onConfirm, onDismiss, onUndismiss,
}: SuggestionsPanelProps) {
  if (suggestions.length === 0 && dismissed.length === 0) return null
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
                      ? <Button disabled={busy} onClick={() => onDismiss(s)} aria-label={`Not ${s.occurrence.name}: ${s.candidate.merchant}`}>Not this</Button>
                      : null}
                    <Button variant="primary" disabled={busy} onClick={() => onConfirm(s)}>Match</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      ) : null}
      {dismissed.length > 0 ? (
        <div className="recur-dismissed">
          <div className="wm-muted recur-sub">Dismissed, not suggested again:</div>
          <ul className="recur-suggestions">
            {dismissed.map((d) => (
              <li key={`${d.occurrence.itemId}:${d.occurrence.nominalDate}:${d.transaction.id}`} className="recur-suggestion recur-sub">
                <span>
                  {d.transaction.merchant}, {formatDate(d.transaction.date)}, {formatMoney(d.transaction.amount, currency)}
                  <span className="wm-muted"> is not {d.occurrence.name} ({formatDate(d.occurrence.expectedDate)})</span>
                </span>
                {onUndismiss !== undefined ? (
                  <button type="button" className="recur-link" disabled={busy} onClick={() => onUndismiss(d)}
                          aria-label={`Undo: ${d.transaction.merchant} is not ${d.occurrence.name}`}>Undo</button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Surface>
  )
}
