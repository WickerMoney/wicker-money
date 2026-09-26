/**
 * How a category counts toward cash flow.
 *
 * `transfer` categories are excluded from both spending and income totals
 * because they represent money moving between the user's own accounts.
 */
export type CategoryKind = 'expense' | 'income' | 'transfer'
