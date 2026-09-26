import type { Category } from '../../../models/index.js'
import type { CategoryEdit } from './CategoryEdit.js'

/** The category table's inline editing state and the actions a row can take. */
export interface CategoryEditing {
  /** The row being edited with its unsaved values, or `null` when none is. */
  readonly editing: CategoryEdit | null
  /** Replaces the unsaved values of the row being edited. */
  readonly change: (next: CategoryEdit) => void
  /** Opens a row for editing its name, parent and kind. */
  readonly start: (category: Category) => void
  /** Closes the editor without saving. */
  readonly cancel: () => void
  /** Saves the row being edited, then asks the page to re-read its list. */
  readonly save: () => Promise<void>
  /** Enables or disables a category. */
  readonly setEnabled: (category: Category, isEnabled: boolean) => Promise<void>
  /** Deletes a category if nothing uses it, after asking the user to confirm. */
  readonly remove: (category: Category) => Promise<void>
}
