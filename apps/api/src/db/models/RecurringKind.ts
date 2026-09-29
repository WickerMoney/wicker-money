/**
 * What a recurring item is, which fixes the shape of its legs: `income` has one
 * or more positive legs, `bill` exactly one negative leg, and `transfer` and
 * `debt_payment` two legs netting to zero (a `debt_payment` pays a card or loan).
 */
export type RecurringKind = 'income' | 'bill' | 'debt_payment' | 'transfer'
