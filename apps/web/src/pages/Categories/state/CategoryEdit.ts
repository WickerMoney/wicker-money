import type { CategoryKind } from '../../../models/index.js'

/** The category row being edited inline, with its unsaved values. */
export interface CategoryEdit {
  /** Id of the category being edited. */
  readonly id: string
  /** Unsaved category name. */
  readonly name: string
  /** Id of the chosen parent, or an empty string for "top level". */
  readonly parentId: string
  /** Unsaved category kind. */
  readonly kind: CategoryKind
}
