import { useId, useState } from 'react'
import { guardBusy } from '@wickermoney/ui-kit'
import { formatDate } from '../../../lib/formatDate.js'
import { formatMoney } from '../../../lib/formatMoney.js'
import type { DismissedSuggestion } from '../../../models/index.js'
import { groupDismissed } from '../helpers/attentionRows.js'

/** Props for {@link DismissedList}. */
export interface DismissedListProps {
  readonly dismissed: readonly DismissedSuggestion[]
  readonly currency: string
  readonly busy: boolean
  readonly onUndismiss?: (dismissed: DismissedSuggestion) => void
}

/**
 * Transactions dismissed with "Not this", folded away until opened and
 * grouped by the item they were dismissed for. Undo lets a pair be suggested
 * again, for a click that was a mistake.
 */
export function DismissedList({ dismissed, currency, busy, onUndismiss }: DismissedListProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  if (dismissed.length === 0) return null
  return (
    <div className="recur-dismissed">
      <button type="button" className="recur-link recur-disclosure" aria-expanded={open} aria-controls={listId}
              onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} Dismissed ({dismissed.length}): not suggested again
      </button>
      <div id={listId} hidden={!open}>
        {open ? groupDismissed(dismissed).map((g) => (
          <section key={g.itemId} aria-label={`Dismissed for ${g.name}`}>
            <h3 className="recur-dismissed__item">{g.name}</h3>
            <ul className="recur-suggestions">
              {g.entries.map((d) => (
                <li key={`${d.occurrence.nominalDate}:${d.transaction.id}`} className="recur-suggestion recur-sub">
                  <span>
                    {d.transaction.merchant}, {formatDate(d.transaction.date)}, {formatMoney(d.transaction.amount, currency)}
                    <span className="wm-muted"> is not the {formatDate(d.occurrence.expectedDate)} one</span>
                  </span>
                  {onUndismiss !== undefined ? (
                    <button type="button" className="recur-link" aria-disabled={busy ? true : undefined}
                            onClick={guardBusy(busy, () => onUndismiss(d))}
                            aria-label={`Undo: ${d.transaction.merchant} is not ${d.occurrence.name}`}>Undo</button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        )) : null}
      </div>
    </div>
  )
}
