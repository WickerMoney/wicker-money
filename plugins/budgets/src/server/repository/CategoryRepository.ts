import type { CategoryRow } from './CategoryRow.js'

/** Read access to the user's categories, for naming budget lines. */
export interface CategoryRepository {
  /** @returns Every category the user can see. */
  list(): Promise<CategoryRow[]>
}
