/** Total spending in one category over the range. */
export interface CategoryTotal {
  /** Category name. */
  readonly name: string
  /** Amount attributed to the category, as an exact four-decimal string. */
  readonly total: string
}
