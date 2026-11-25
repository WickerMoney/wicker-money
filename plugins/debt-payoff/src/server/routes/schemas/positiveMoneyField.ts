import { moneyField } from './moneyField.js'

/** An amount as {@link moneyField} reads it (so zero is always `'0.0000'`), and more than zero: a payment of nothing is not a payment. */
export const positiveMoneyField = moneyField.refine((value) => value !== '0.0000', 'Enter an amount more than zero.')
