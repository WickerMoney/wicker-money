import { formatMoney } from '../../../lib/formatMoney.js'
import type { RecurringItem } from '../../../models/index.js'

/** Props for {@link AmountCell}. */
export interface AmountCellProps {
  readonly value: string
  readonly kind: RecurringItem['kind']
  readonly currency: string
}

/**
 * An amount coloured by what it means for the household: income green, bills
 * and debt payments red, transfers neutral (money moving between your own
 * accounts is neither earned nor spent).
 */
export function AmountCell({ value, kind, currency }: AmountCellProps) {
  const tone = kind === 'income' ? 'wm-pos' : kind === 'transfer' ? undefined : 'wm-neg'
  // A debt payment's headline is what it moves (positive); shown as the
  // outgoing it is from the household's point of view.
  const shown = kind === 'debt_payment' && !value.startsWith('-') ? `-${value}` : value
  return <span className={tone}>{formatMoney(shown, currency)}</span>
}
