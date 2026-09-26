/** Fields required to create a rule row. */
export interface NewRuleInput {
  readonly userId: string
  readonly categoryId: string
  readonly priority: number
}
