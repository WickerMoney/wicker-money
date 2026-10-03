import type { UpcomingOccurrence } from '../models/index.js'
import { statusTag } from '../helpers/statusTag.js'
import { whereTo } from '../helpers/whereTo.js'

/** Props for {@link UpcomingList}. */
export interface UpcomingListProps {
  readonly occurrences: readonly UpcomingOccurrence[]
  readonly accountName: (id: string) => string
  readonly formatMoney: (value: string) => string
  readonly formatDate: (value: string) => string
}

/**
 * What lands between now and payday, in date order. Income in green, bills
 * and debt payments in red, transfers in a neutral colour with from → to:
 * moving money between your own accounts is neither earned nor spent.
 *
 * Anything that already arrived is tagged and muted (it is in the balance,
 * not still to come); anything late says so, because a missing paycheck is
 * worth chasing.
 */
export function UpcomingList({ occurrences, accountName, formatMoney, formatDate }: UpcomingListProps) {
  return (
    <ul className="upc-list">
      {occurrences.map((o) => {
        const tone = o.kind === 'income' ? 'upc-pos' : o.kind === 'transfer' ? 'upc-neutral' : 'upc-neg'
        // A debt payment's headline is what it moves; from the household's
        // point of view it is an outgoing.
        const shown = o.kind === 'debt_payment' && !o.amount.startsWith('-') ? `-${o.amount}` : o.amount
        const tag = statusTag(o, formatDate)
        const arrived = o.status === 'cleared'
        return (
          <li key={`${o.itemId}:${o.nominalDate ?? o.date}`} className={`upc-list__item${arrived ? ' is-arrived' : ''}`}>
            <span className="upc-list__date">{formatDate(o.date)}</span>
            <span className="upc-list__what">
              <span className="upc-list__name">
                {o.name}
                {tag !== null ? <span className={`upc-tag${tag.tone === 'warn' ? ' upc-tag--warn' : ''}`}>{tag.label}</span> : null}
              </span>
              <span className="upc-muted">{whereTo(o, accountName)}</span>
            </span>
            <span className={`upc-num ${arrived ? 'upc-muted' : tone}`}>{formatMoney(shown)}</span>
          </li>
        )
      })}
    </ul>
  )
}
