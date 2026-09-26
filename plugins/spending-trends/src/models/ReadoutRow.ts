/** One category's line in a month's tooltip. */
export interface ReadoutRow {
  /** The series id. */
  readonly id: string
  /** Category name. */
  readonly name: string
  /** The series' colour. */
  readonly color: string
  /** The exact amount, as a four-decimal string; negative for a net refund. */
  readonly value: string
}
