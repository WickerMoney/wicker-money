import type { CategoryKind } from '../../db/models/CategoryKind.js'

/** An enabled category as offered to a picker: identity, parentage and kind. */
export interface CategoryPick {
  /** Category id. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** The parent category's id, or `null` for a top-level category. */
  readonly parent_id: string | null
  /**
   * `expense`, `income` or `transfer`. Lets a picker offer only the categories
   * that make sense for it: a budget, for example, never counts income or
   * transfers as spending, so a budget line on one would always read zero.
   */
  readonly kind: CategoryKind
}
