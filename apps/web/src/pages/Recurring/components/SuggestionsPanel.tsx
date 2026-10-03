import { Button, Surface } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { MatchSuggestion } from '../../../models/index.js'
import { dayDifferenceText } from '../helpers/occurrenceLabels.js'

/** Props for {@link SuggestionsPanel}. */
export interface SuggestionsPanelProps {
  readonly suggestions: readonly MatchSuggestion[]
  readonly currency: string
  readonly accountName: (id: string) => string
  readonly busy: boolean
  readonly onConfirm: (suggestion: MatchSuggestion) => void
}

/**
 * Transactions that look like a recent occurrence's payment, waiting for a
 * click. Confirming one tells the forecast and "Until payday" the money has
 * landed, so it is not counted again. Nothing here is matched on its own.
 * Hidden when there is nothing to confirm.
 */
export function SuggestionsPanel({ suggestions, currency, accountName, busy, onConfirm }: SuggestionsPanelProps) {
  if (suggestions.length === 0) return null
  return (
    <Surface title="Did these land?">
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
              <Button variant="primary" disabled={busy} onClick={() => onConfirm(s)}>Match</Button>
            </li>
          )
        })}
      </ul>
    </Surface>
  )
}
