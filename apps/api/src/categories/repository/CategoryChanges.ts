import type { CategoryKind } from '../../db/models/index.js'

/** A partial update to a category. Absent keys are left unchanged; `null` clears a nullable field. */
export interface CategoryChanges {
  readonly name?: string
  readonly parentId?: string | null
  readonly icon?: string | null
  readonly isEnabled?: boolean
  readonly kind?: CategoryKind
  readonly sortOrder?: number
}
