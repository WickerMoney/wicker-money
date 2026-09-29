import type { RecurringItem } from '../../../models/index.js'

/** Props for {@link LegsCell}. */
export interface LegsCellProps {
  readonly item: RecurringItem
  readonly accountName: (id: string) => string
}

/**
 * Where an item's money goes: the paying account for a bill, `Checking + Savings`
 * for a split paycheck, and `Checking → Savings` for a transfer or debt payment.
 */
export function LegsCell({ item, accountName }: LegsCellProps) {
  if (item.kind === 'transfer' || item.kind === 'debt_payment') {
    const from = item.legs.find((l) => l.amount.startsWith('-'))
    const to = item.legs.find((l) => !l.amount.startsWith('-'))
    return (
      <span>
        {from === undefined ? '?' : accountName(from.accountId)}
        <span className="recur-arrow" aria-label="to"> → </span>
        {to === undefined ? '?' : accountName(to.accountId)}
      </span>
    )
  }
  return <span>{item.legs.map((l) => accountName(l.accountId)).join(' + ')}</span>
}
