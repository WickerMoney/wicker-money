import type { ReferenceUsage } from '../../db/usage.js'

/** What still references a category: foreign-key usage plus its direct children. */
export interface CategoryUsage extends ReferenceUsage {
  /** Number of direct child categories. Included in `total`. */
  readonly childCount: number
}
