/**
 * Whether a category can usefully carry a budget line.
 *
 * A budget measures outflow, so the spend query leaves out categories of kind
 * `income` and `transfer` (see `QuerySpendRepository`). A line on one of those
 * would always show nothing spent, however much moved through it, so the
 * pickers do not offer them. Any other kind is offered, including one added
 * later, which is the same rule the spend query applies. A category with no
 * kind (an older server) is offered too, because the page should not go empty
 * just because the server is behind.
 *
 * @param category - Anything with an optional `kind`.
 * @returns `false` only for `income` and `transfer`.
 */
export function isBudgetable(category: { readonly kind?: string }): boolean {
  return category.kind !== 'income' && category.kind !== 'transfer'
}
